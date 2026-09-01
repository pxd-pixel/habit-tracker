(function (global) {
  'use strict';

  /* ================= 数据层（纯逻辑，可单元测试） ================= */

  var STORAGE_KEYS = {
    habits: 'habit-tracker.habits',
    records: 'habit-tracker.records',
    version: 'habit-tracker.version'
  };
  var DATA_VERSION = 1;
  var WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayKey(now) { return dateKey(now || new Date()); }

  function lastNDays(n, now) {
    var days = [];
    var base = new Date(now || new Date());
    for (var i = n - 1; i >= 0; i--) {
      var cur = new Date(base);
      cur.setDate(base.getDate() - i);
      days.push(cur);
    }
    return days;
  }

  function isDone(records, habitId, key) {
    return !!(records[key] && records[key][habitId]);
  }

  function countDoneOn(records, habitIds, key) {
    var day = records[key] || {};
    var n = 0;
    for (var i = 0; i < habitIds.length; i++) {
      if (day[habitIds[i]]) n++;
    }
    return n;
  }

  /* 连续打卡天数：今天已完成则从今天往前数；今天未完成则从昨天往前数 */
  function calcStreak(records, habitId, now) {
    var ref = new Date(now || new Date());
    var streak = 0;
    if (!isDone(records, habitId, dateKey(ref))) {
      ref.setDate(ref.getDate() - 1);
    }
    while (isDone(records, habitId, dateKey(ref))) {
      streak++;
      ref.setDate(ref.getDate() - 1);
    }
    return streak;
  }

  function calcRate(records, habitId, days) {
    var done = 0;
    for (var i = 0; i < days.length; i++) {
      if (isDone(records, habitId, dateKey(days[i]))) done++;
    }
    return days.length ? done / days.length : 0;
  }

  function sanitizeHabits(raw) {
    if (!Array.isArray(raw)) return [];
    var now = Date.now();
    return raw
      .filter(function (h) { return h && typeof h.id === 'string' && typeof h.name === 'string'; })
      .map(function (h, i) {
        return {
          id: h.id,
          name: h.name.trim(),
          createdAt: typeof h.createdAt === 'number' ? h.createdAt : now,
          sortOrder: typeof h.sortOrder === 'number' ? h.sortOrder : i
        };
      })
      .sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  }

  function sanitizeRecords(raw, habitIds) {
    var out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      Object.keys(raw).forEach(function (day) {
        var map = raw[day];
        if (typeof day !== 'string' || !map || typeof map !== 'object' || Array.isArray(map)) return;
        var clean = {};
        for (var i = 0; i < habitIds.length; i++) {
          if (map[habitIds[i]]) clean[habitIds[i]] = true;
        }
        if (Object.keys(clean).length) out[day] = clean;
      });
    }
    return out;
  }

  function buildExportPayload(habits, records, now) {
    return {
      app: 'habit-tracker',
      version: DATA_VERSION,
      exportedAt: (now || new Date()).toISOString(),
      habits: habits,
      records: records
    };
  }

  function validateImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: '文件内容不是有效的备份数据' };
    }
    if (!Array.isArray(data.habits)) return { ok: false, error: '缺少 habits 数据' };
    if (!data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
      return { ok: false, error: '缺少 records 数据' };
    }
    var habits = sanitizeHabits(data.habits);
    var records = sanitizeRecords(data.records, habits.map(function (h) { return h.id; }));
    return { ok: true, habits: habits, records: records };
  }

  function makeId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function createStore(storage) {
    function loadHabits() {
      try {
        var raw = storage.getItem(STORAGE_KEYS.habits);
        return sanitizeHabits(raw ? JSON.parse(raw) : []);
      } catch (e) { return []; }
    }
    function loadRecords() {
      try {
        var raw = storage.getItem(STORAGE_KEYS.records);
        var parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (e) { return {}; }
    }
    function saveHabits(list) { storage.setItem(STORAGE_KEYS.habits, JSON.stringify(list)); }
    function saveRecords(recs) { storage.setItem(STORAGE_KEYS.records, JSON.stringify(recs)); }
    function saveAll(list, recs) {
      saveHabits(list);
      saveRecords(recs);
      storage.setItem(STORAGE_KEYS.version, String(DATA_VERSION));
    }
    return {
      loadHabits: loadHabits,
      loadRecords: loadRecords,
      saveHabits: saveHabits,
      saveRecords: saveRecords,
      saveAll: saveAll
    };
  }

  var core = {
    STORAGE_KEYS: STORAGE_KEYS,
    DATA_VERSION: DATA_VERSION,
    WEEKDAY_NAMES: WEEKDAY_NAMES,
    dateKey: dateKey,
    todayKey: todayKey,
    lastNDays: lastNDays,
    isDone: isDone,
    countDoneOn: countDoneOn,
    calcStreak: calcStreak,
    calcRate: calcRate,
    sanitizeHabits: sanitizeHabits,
    sanitizeRecords: sanitizeRecords,
    buildExportPayload: buildExportPayload,
    validateImport: validateImport,
    makeId: makeId,
    createStore: createStore
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = core;
  }

  /* ================= 视图层 ================= */

  if (typeof document === 'undefined') return;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    var store = createStore(global.localStorage);
    var habits = store.loadHabits();
    var records = sanitizeRecords(store.loadRecords(), habits.map(function (h) { return h.id; }));

    var todayLabel = document.getElementById('todayLabel');
    var summaryCount = document.getElementById('summaryCount');
    var progressFill = document.getElementById('progressFill');
    var progressTip = document.getElementById('progressTip');
    var habitList = document.getElementById('habitList');
    var emptyState = document.getElementById('emptyState');
    var addForm = document.getElementById('addForm');
    var habitInput = document.getElementById('habitInput');
    var barChart = document.getElementById('barChart');
    var statList = document.getElementById('statList');
    var statsEmpty = document.getElementById('statsEmpty');
    var exportBtn = document.getElementById('exportBtn');
    var importBtn = document.getElementById('importBtn');
    var importFile = document.getElementById('importFile');
    var backupStatus = document.getElementById('backupStatus');

    function persist() { store.saveAll(habits, records); }

    function removeHabitRecords(id) {
      Object.keys(records).forEach(function (day) {
        delete records[day][id];
        if (!Object.keys(records[day]).length) delete records[day];
      });
    }

    function renderToday() {
      var today = todayKey();
      var day = records[today] || {};
      var total = habits.length;
      var done = 0;
      habits.forEach(function (h) { if (day[h.id]) done++; });

      summaryCount.textContent = done + ' / ' + total;
      var pct = total ? Math.round((done / total) * 100) : 0;
      progressFill.style.width = pct + '%';

      if (!total) {
        progressTip.textContent = '添加习惯后开始打卡吧';
      } else if (done === total) {
        progressTip.textContent = '全部完成，太棒了！🎉';
      } else {
        progressTip.textContent = '还差 ' + (total - done) + ' 项，继续加油 💪';
      }

      habitList.innerHTML = '';
      emptyState.hidden = total > 0;

      habits.forEach(function (habit) {
        var doneToday = !!day[habit.id];
        var li = document.createElement('li');
        li.className = 'habit-item' + (doneToday ? ' done' : '');

        var check = document.createElement('button');
        check.type = 'button';
        check.className = 'check-btn';
        check.setAttribute('aria-label', doneToday ? '取消打卡' : '完成打卡');
        check.textContent = doneToday ? '✓' : '';

        var name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = habit.name;
        name.title = '点击修改名称';

        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del-btn';
        del.setAttribute('aria-label', '删除习惯');
        del.textContent = '✕';

        li.appendChild(check);
        li.appendChild(name);
        li.appendChild(del);

        check.addEventListener('click', function () {
          var cur = records[today] || (records[today] = {});
          if (cur[habit.id]) {
            delete cur[habit.id];
          } else {
            cur[habit.id] = true;
          }
          if (!Object.keys(cur).length) delete records[today];
          persist();
          render();
        });

        name.addEventListener('click', function () {
          var input = prompt('修改习惯名称：', habit.name);
          if (input === null) return;
          var trimmed = input.trim();
          if (!trimmed) return;
          habit.name = trimmed.slice(0, 20);
          persist();
          render();
        });

        del.addEventListener('click', function () {
          if (!confirm('确定删除「' + habit.name + '」吗？它的打卡记录也会一并删除。')) return;
          habits = habits.filter(function (h) { return h.id !== habit.id; });
          removeHabitRecords(habit.id);
          persist();
          render();
        });

        habitList.appendChild(li);
      });
    }

    function renderBarChart() {
      var days = lastNDays(7);
      var ids = habits.map(function (h) { return h.id; });
      var counts = days.map(function (d) { return countDoneOn(records, ids, dateKey(d)); });
      var max = Math.max.apply(null, counts.concat([1]));

      var W = 340, H = 190, left = 26, right = 26, top = 34, bottom = 40;
      var innerW = W - left - right;
      var innerH = H - top - bottom;
      var gap = 16;
      var barW = (innerW - gap * (days.length - 1)) / days.length;
      var bars = '';

      days.forEach(function (d, i) {
        var x = left + i * (barW + gap);
        var h = (counts[i] / max) * innerH;
        var y = top + innerH - h;
        var isToday = i === days.length - 1;
        var color = isToday ? '#2fbf8f' : '#cdeee1';
        var labelCls = isToday ? 'bar-label today' : 'bar-label';
        bars +=
          '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(6, barW / 2).toFixed(1) + '" fill="' + color + '"/>' +
          '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" text-anchor="middle" class="bar-count">' + counts[i] + '</text>' +
          '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 14).toFixed(1) + '" text-anchor="middle" class="' + labelCls + '">' + (d.getMonth() + 1) + '/' + d.getDate() + '</text>';
      });

      barChart.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="最近7天完成数柱状图" xmlns="http://www.w3.org/2000/svg">' + bars + '</svg>';
    }

    function renderStatList() {
      statList.innerHTML = '';
      statsEmpty.hidden = habits.length > 0;
      var days = lastNDays(7);
      habits.forEach(function (habit) {
        var rate = calcRate(records, habit.id, days);
        var streak = calcStreak(records, habit.id);
        var pct = Math.round(rate * 100);
        var li = document.createElement('li');
        li.className = 'stat-item';
        li.innerHTML =
          '<div class="stat-head">' +
            '<span class="stat-name">' + escapeHtml(habit.name) + '</span>' +
            '<span class="stat-nums">完成率 ' + pct + '% · 连续 ' + streak + ' 天</span>' +
          '</div>' +
          '<div class="stat-track"><div class="stat-fill" style="width:' + pct + '%"></div></div>';
        statList.appendChild(li);
      });
    }

    function renderStats() {
      renderBarChart();
      renderStatList();
    }

    function render() {
      renderToday();
      renderStats();
    }

    function showBackupStatus(msg, kind) {
      backupStatus.textContent = msg;
      backupStatus.className = 'backup-status' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
    }

    /* ---- 事件绑定 ---- */

    addForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = habitInput.value.trim();
      if (!name) return;
      var maxOrder = 0;
      habits.forEach(function (h) { if (h.sortOrder > maxOrder) maxOrder = h.sortOrder; });
      habits.push({ id: makeId(), name: name.slice(0, 20), createdAt: Date.now(), sortOrder: maxOrder + 1 });
      habitInput.value = '';
      persist();
      render();
    });

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
        document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + btn.dataset.tab); });
      });
    });

    exportBtn.addEventListener('click', function () {
      var payload = buildExportPayload(habits, records);
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '习惯打卡备份-' + todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showBackupStatus('已导出备份 ✓', 'ok');
    });

    importBtn.addEventListener('click', function () { importFile.click(); });

    importFile.addEventListener('change', function () {
      var file = importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          var result = validateImport(data);
          if (!result.ok) {
            showBackupStatus(result.error, 'err');
            return;
          }
          habits = result.habits;
          records = result.records;
          persist();
          render();
          showBackupStatus('导入成功，数据已恢复 ✓', 'ok');
        } catch (err) {
          showBackupStatus('导入失败：文件不是有效的 JSON', 'err');
        } finally {
          importFile.value = '';
        }
      };
      reader.readAsText(file);
    });


    /* ---- PWA：注册离线缓存 Service Worker（仅 http/https 下） ---- */
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      });
    }

    /* ---- 初始化 ---- */

    var now = new Date();
    todayLabel.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' + WEEKDAY_NAMES[now.getDay()];

    render();

    /* 跨天自动刷新 */
    var lastDay = todayKey();
    setInterval(function () {
      var d = todayKey();
      if (d !== lastDay) {
        lastDay = d;
        var n = new Date();
        todayLabel.textContent = (n.getMonth() + 1) + '月' + n.getDate() + '日 · ' + WEEKDAY_NAMES[n.getDay()];
        render();
      }
    }, 60000);
  }

  init();
})(typeof window !== 'undefined' ? window : globalThis);