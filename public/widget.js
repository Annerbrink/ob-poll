'use strict';

(function () {
  var CHOICES = ['1', 'X', '2'];
  var pollId = new URLSearchParams(location.search).get('poll');

  var el = {
    loading: document.getElementById('loading'),
    content: document.getElementById('content'),
    fixture: document.getElementById('fixture'),
    kickoff: document.getElementById('kickoff'),
    choices: document.getElementById('choices'),
    results: document.getElementById('results'),
    summary: document.getElementById('summary'),
    error: document.getElementById('error')
  };

  var rows = {};
  var labels = { '1': '', X: 'Oavgjort', '2': '' };

  /**
   * The reader id lives in localStorage because third-party cookies are blocked
   * in framed contexts; the server accepts it as a header and mirrors it back.
   */
  function voterId(value) {
    try {
      if (value) localStorage.setItem('voterId', value);
      return localStorage.getItem('voterId');
    } catch (e) {
      return value || null;
    }
  }

  function request(path, options) {
    var settings = options || {};
    settings.headers = settings.headers || {};
    settings.headers['Content-Type'] = 'application/json';

    var id = voterId();
    if (id) settings.headers['X-Voter-Id'] = id;
    settings.credentials = 'include';

    return fetch(path, settings).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) throw new Error(body.error || 'Något gick fel');
        if (body.voterId) voterId(body.voterId);
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
    labels['1'] = poll.homeTeam;
    labels['2'] = poll.awayTeam;

    el.fixture.textContent = poll.homeTeam + ' – ' + poll.awayTeam;
    el.kickoff.textContent = formatKickoff(poll);
    document.getElementById('team-home').textContent = poll.homeTeam;
    document.getElementById('team-away').textContent = poll.awayTeam;

    CHOICES.forEach(function (choice) {
      var row = rows[choice];
      var percent = poll.percentages[choice];
      var count = poll.counts[choice];

      row.classList.toggle('mine', poll.yourVote === choice);
      row.querySelector('.name').textContent = choice + ' · ' + labels[choice];
      row.querySelector('.pct').textContent = percent + ' %';
      row.querySelector('.fill').style.width = percent + '%';
      row.querySelector('.count').textContent = count + (count === 1 ? ' röst' : ' röster');

      var button = el.choices.querySelector('.choice[data-choice="' + choice + '"]');
      button.setAttribute('aria-pressed', poll.yourVote === choice ? 'true' : 'false');
      button.disabled = poll.closed;
    });

    var votes = poll.total + (poll.total === 1 ? ' röst' : ' röster');
    if (poll.closed) {
      el.summary.textContent = 'Omröstningen är stängd · ' + votes;
    } else if (poll.yourVote) {
      el.summary.textContent = 'Du tippade ' + poll.yourVote + ' · ' + votes;
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
    request('/api/polls/' + encodeURIComponent(pollId) + '/votes', {
      method: 'POST',
      body: JSON.stringify({ choice: button.dataset.choice })
    })
      .then(function (body) { render(body.poll); })
      .catch(function (error) { showError(error.message); });
  });

  function load() {
    return request('/api/polls/' + encodeURIComponent(pollId))
      .then(function (body) { render(body.poll); })
      .catch(function (error) { showError(error.message); });
  }

  if (!pollId) {
    showError('Ingen omröstning angiven.');
  } else {
    buildRows();
    load();
    // Keeps the bars fresh while the article is open.
    setInterval(load, 15000);
    window.addEventListener('resize', reportHeight);
  }
})();
