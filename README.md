# 1 X 2 Football Poll Widget

A single self-contained HTML file (`poll-widget.html`) — no build step, no dependencies,
no backend. Users pick **1** (home win), **X** (draw) or **2** (away win) and the results
are shown as percentage bars.

## Embed

Host `poll-widget.html` anywhere static and drop it into an iframe:

```html
<iframe src="poll-widget.html"
        title="1 X 2 poll"
        style="width:100%;max-width:480px;height:520px;border:0"
        loading="lazy"></iframe>
```

## Configure the match

Either edit the `data-*` attributes on `<section class="poll">` in the file:

```html
<section class="poll"
         data-poll-id="ois-ifk-2026-08-08"
         data-home="Örgryte IS"
         data-away="IFK Göteborg"
         data-kickoff="2026-08-08T17:00:00+02:00">
```

…or pass them as query parameters on the iframe `src`, which lets one hosted copy serve
many matches:

```html
<iframe src="poll-widget.html?id=ois-ifk-2026-08-08&home=Örgryte%20IS&away=IFK%20Göteborg&kickoff=2026-08-08T17:00:00%2B02:00"></iframe>
```

`id` keys the stored votes — give each match its own value.

## Behaviour

- One vote per browser; clicking a different option moves the vote, "Reset my vote" clears it.
- Percentages use largest-remainder rounding, so the three numbers always sum to 100%.
- Votes are kept in `localStorage`, so tallies are per-browser. For results shared across
  all visitors, point the vote/read calls at a backend instead.
- Follows the visitor's light/dark colour scheme.
