'use strict';

/**
 * The paper and its readers are in Sweden, so every time is shown in Swedish
 * time and every time the author types is read as Swedish time — a reader
 * abroad should still see "avspark 15:00", not their own clock.
 */
var OB_TIME = (function () {
  var ZONE = 'Europe/Stockholm';

  function zoneOffsetMinutes(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ZONE, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).reduce(function (acc, part) {
      acc[part.type] = part.value;
      return acc;
    }, {});

    var asUtc = Date.UTC(
      parts.year, parts.month - 1, parts.day,
      parts.hour % 24, parts.minute, parts.second
    );
    return (asUtc - date.getTime()) / 60000;
  }

  return {
    /** "2026-08-15T15:00" from a datetime-local field -> ISO instant in Swedish time. */
    toIso: function (localValue) {
      if (!localValue) return null;
      var naive = new Date(localValue + 'Z');
      if (isNaN(naive.getTime())) return null;
      return new Date(naive.getTime() - zoneOffsetMinutes(naive) * 60000).toISOString();
    },

    format: function (iso, options) {
      if (!iso) return '';
      var date = new Date(iso);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleString('sv-SE', Object.assign({ timeZone: ZONE }, options));
    }
  };
})();
