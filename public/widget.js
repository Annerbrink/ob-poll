'use strict';

(function () {
  var CHOICES = ['1', 'X', '2'];
  var REFRESH_MS = 60000;
  // Comfortably longer than the results cache, so a stale copy can't outlive it.
  var FRESH_AFTER_VOTE_MS = 25000;

  var params = new URLSearchParams(location.search);
  var pollId = params.get('poll');
  // Renders straight from the query string without touching the API, so an
  // author can see the widget while still filling in the create form.
  var previewMode = params.get('preview') === '1';
  var timer = null;
  var loading = false;
  var closed = false;

  var el = {
    loading: document.getElementById('loading'),
    content: document.getElementById('content'),
    category: document.getElementById('category'),
    fixture: document.getElementById('fixture'),
    kickoff: document.getElementById('kickoff'),
    choices: document.getElementById('choices'),
    results: document.getElementById('results'),
    summary: document.getElementById('summary'),
    error: document.getElementById('error')
  };

  var rows = {};
  var labels = { '1': '', X: 'Oavgjort', '2': '' };
  var CATEGORY_LABELS = { herr: 'Herr', dam: 'Dam' };

  /**
   * Both the reader id and the sign they picked live in localStorage, because
   * third-party cookies are blocked in framed contexts. Keeping the sign here
   * rather than asking the server for it is also what keeps the results
   * response identical for every reader, and therefore cacheable.
   */
  function stored(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      return localStorage.getItem(key);
    } catch (e) {
      return value || null;
    }
  }

  function voterId() {
    var id = stored('voterId');
    if (id) return id;

    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return stored('voterId', Array.prototype.map.call(bytes, function (byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join(''));
  }

  function myVote(choice) {
    if (choice) stored('voted-at:' + pollId, String(Date.now()));
    return stored('vote:' + pollId, choice);
  }

  /**
   * Results are cached for a few seconds, which is fine for everyone else's votes
   * but not for the reader's own: a cached snapshot from just before they voted
   * would tell them they picked X while showing nought votes. So for as long as
   * a stale copy could still be in play, ask for an uncached one.
   */
  function resultsUrl() {
    var votedAt = Number(stored('voted-at:' + pollId));
    var path = '/api/polls/' + encodeURIComponent(pollId);
    return votedAt && Date.now() - votedAt < FRESH_AFTER_VOTE_MS
      ? path + '?sedan=' + votedAt
      : path;
  }

  function request(path, options) {
    var settings = options || {};
    settings.headers = settings.headers || {};
    settings.headers['Content-Type'] = 'application/json';

    if (settings.method === 'POST') {
      settings.headers['X-Voter-Id'] = voterId();
      settings.credentials = 'include';
    }

    return fetch(path, settings).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || 'Något gick fel');
        return body;
      });
    });
  }

  function buildRows() {
    CHOICES.forEach(function (choice) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML =
        '<div class="row-head"><span class="name"></span><span class="pct">0 %</span></div>' +
        '<div class="track"><div class="fill"></div></div>' +
        '<p class="count"></p>';
      el.results.appendChild(row);
      rows[choice] = row;
    });
  }

  function formatKickoff(poll) {
    var formatted = OB_TIME.format(poll.kickoff, {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
    });
    return formatted ? 'Avspark ' + formatted : '';
  }

  function render(poll) {
    var mine = poll.yourVote || myVote();

    labels['1'] = poll.homeTeam;
    labels['2'] = poll.awayTeam;

    if (poll.closed) {
      closed = true;
      stopRefreshing();
    }

    var category = CATEGORY_LABELS[poll.category];
    el.category.textContent = category || '';
    el.category.hidden = !category;

    el.fixture.textContent = poll.homeTeam + ' – ' + poll.awayTeam;
    el.kickoff.textContent = formatKickoff(poll);
    document.getElementById('team-home').textContent = poll.homeTeam;
    document.getElementById('team-away').textContent = poll.awayTeam;

    CHOICES.forEach(function (choice) {
      var row = rows[choice];
      var percent = poll.percentages[choice];
      var count = poll.counts[choice];

      row.classList.toggle('mine', mine === choice);
      row.querySelector('.name').textContent = choice + ' · ' + labels[choice];
      row.querySelector('.pct').textContent = percent + ' %';
      row.querySelector('.fill').style.width = percent + '%';
      row.querySelector('.count').textContent = count + (count === 1 ? ' röst' : ' röster');

      var button = el.choices.querySelector('.choice[data-choice="' + choice + '"]');
      button.setAttribute('aria-pressed', mine === choice ? 'true' : 'false');
      button.disabled = poll.closed;
    });

    var votes = poll.total + (poll.total === 1 ? ' röst' : ' röster');
    if (poll.closed) {
      el.summary.textContent = 'Omröstningen är stängd · ' + votes;
    } else if (mine) {
      el.summary.textContent = 'Du tippade ' + labels[mine] + ' och totalt ' + votes;
    } else {
      el.summary.textContent = poll.total === 0
        ? 'Inga röster än – tippa 1, X eller 2'
        : votes + ' hittills';
    }

    el.loading.hidden = true;
    el.content.hidden = false;
    reportHeight();
  }

  function showError(message) {
    el.error.textContent = message;
    el.error.hidden = false;
    el.loading.hidden = true;
    reportHeight();
  }

  /** Lets the article page resize the iframe to fit the widget. */
  function reportHeight() {
    if (window.parent === window) return;
    window.parent.postMessage(
      { type: 'ob-poll:height', poll: pollId, height: document.body.scrollHeight },
      '*'
    );
  }

  el.choices.addEventListener('click', function (event) {
    var button = event.target.closest('.choice');
    if (!button || button.disabled) return;

    el.error.hidden = true;

    if (previewMode) {
      simulateVote(button.dataset.choice);
      return;
    }

    request('/api/polls/' + encodeURIComponent(pollId) + '/votes', {
      method: 'POST',
      body: JSON.stringify({ choice: button.dataset.choice })
    })
      .then(function (body) {
        myVote(body.poll.yourVote);
        render(body.poll);
      })
      .catch(function (error) { showError(error.message); });
  });

  function load() {
    if (loading) return Promise.resolve();
    loading = true;
    return request(resultsUrl())
      .then(function (body) { render(body.poll); })
      .catch(function (error) { showError(error.message); })
      .then(function () { loading = false; });
  }

  /**
   * An article can sit open in a background tab for hours, so the bars only
   * refresh while someone is actually looking at them — and not at all once
   * voting has closed and the numbers are final.
   */
  function startRefreshing() {
    if (timer || closed) return;
    timer = setInterval(load, REFRESH_MS);
  }

  function stopRefreshing() {
    clearInterval(timer);
    timer = null;
  }

  /** A poll assembled from the query string, shown before anything is saved. */
  var preview = null;
  function previewPoll() {
    if (!preview) {
      preview = {
        id: 'preview',
        homeTeam: params.get('home') || 'Hemmalag',
        awayTeam: params.get('away') || 'Bortalag',
        kickoff: params.get('kickoff') || null,
        closesAt: params.get('closes') || null,
        category: params.get('category') || null,
        closed: false,
        counts: { '1': 0, X: 0, '2': 0 },
        percentages: { '1': 0, X: 0, '2': 0 },
        total: 0,
        yourVote: null
      };
    }
    return preview;
  }

  /** Moves the preview's vote and re-tallies it locally, no request involved. */
  function simulateVote(choice) {
    var poll = previewPoll();
    if (poll.yourVote === choice) return;

    if (poll.yourVote) poll.counts[poll.yourVote] -= 1;
    poll.counts[choice] += 1;
    poll.yourVote = choice;
    poll.total = CHOICES.reduce(function (sum, key) { return sum + poll.counts[key]; }, 0);
    poll.percentages = previewPercentages(poll.counts);
    render(poll);
  }

  /** The same largest-remainder rounding the server uses, for the preview only. */
  function previewPercentages(counts) {
    var total = CHOICES.reduce(function (sum, key) { return sum + counts[key]; }, 0);
    if (total === 0) return { '1': 0, X: 0, '2': 0 };

    var exact = CHOICES.map(function (key) { return (counts[key] / total) * 100; });
    var whole = exact.map(Math.floor);
    var remaining = 100 - whole.reduce(function (a, b) { return a + b; }, 0);

    exact
      .map(function (value, index) { return { index: index, fraction: value - whole[index] }; })
      .sort(function (a, b) { return b.fraction - a.fraction; })
      .slice(0, remaining)
      .forEach(function (entry) { whole[entry.index] += 1; });

    return { '1': whole[0], X: whole[1], '2': whole[2] };
  }

  if (previewMode) {
    buildRows();
    render(previewPoll());
    window.addEventListener('resize', reportHeight);
  } else if (!pollId) {
    showError('Ingen omröstning angiven.');
  } else {
    buildRows();
    load();
    startRefreshing();

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopRefreshing();
      } else {
        load();
        startRefreshing();
      }
    });

    window.addEventListener('resize', reportHeight);
  }
})();
