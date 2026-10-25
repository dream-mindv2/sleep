# Handoff: sleep, a terminal emulator written in Dream

This document hands off work in progress to another model. Read the
workspace's `CLAUDE.md` first: its rules apply to everything here, including
type signatures, `std`, strict parameters, the house comment style, keeping
the build warning-free, `just reseed` after any std or compiler change, and
committing only when the user asks.

## What the user asked for

1. A new repository in the dream-mindv2 org called **sleep**: a terminal
   emulator app written in Dream, with a modern, clean interface.
2. Build the interface with `std.graphics.widgets`, not raw `std.graphics`.
   Extend the kit wherever it falls short.
3. "Since we have std.ml, build a bunch of features that include ML
   algorithms to assist the user. Go all out."
4. Tab kinds:
   - terminal tabs;
   - **request tabs**, to send, receive and debug HTTP requests;
   - **database tabs**;
   - a **settings tab**.
5. **Command queue.** While a command runs, the user can queue the next one.
   A customizable shortcut (default Ctrl+Shift+Q) opens a popup entry in the
   top right, and a toolbar button opens it too.
6. **Colour schemes** that are easy to change from the Settings tab.
7. **Animation overlays**, optional and customizable with CSS, for moments
   such as "a command is running and you're waiting". They should be small,
   cute or cool.
8. PTY support may be added to std if needed. It was added.
9. The old `sleep/` directory in the workspace, an unrelated sleep-lab demo,
   was removed at the user's request. The new app lives at `sleep/`, a
   submodule backed by `github.com/dream-mindv2/sleep`.

Everything is committed and pushed: `dream`, `mind/std`, `dreams` (the
reseed), `sleep` at `github.com/dream-mindv2/sleep`, and the workspace with
`sleep/` as a submodule. The TODO below is done (2026-10-24) but for the
optional performance work.

## Current state: it works

Screenshots were taken under Xvfb; see "Running it" below. Verified working:

- **Terminal**
  - Real shell on a PTY, with 16, 256 and 24-bit colour, `ls --color`, the
    alternate screen (`less` checked against its raw output), and DEC line
    drawing.
  - Tab titles come from OSC 0/2, the working directory from OSC 7, and the
    prompt shows correctly.
- **Shell integration** (bash and zsh, through rc injection)
  - OSC 133 A/B/C/D marks plus OSC 633;E for the command line.
  - These give command blocks, with exit status and duration, and gutter
    marks.
- **Assistant sidebar**
  - "Next, probably" predictions, from an n-gram model blended with an MLP
    trained by `ml.fit!` in the background. It reaches 36% held-out accuracy
    on about 2,100 history lines.
  - "Did you mean" typo fixes (`gti status` → `git status`).
  - Failure explanations from a naive Bayes line classifier and a table of
    known failures matched by regex and TF-IDF.
  - An Ask box (plain English to a command, from a cookbook with TF-IDF
    retrieval and slot filling), and a list of recent blocks.
- **Autosuggest ghost text** works at the backend. Right arrow accepts it.
- **Risk guard.** Enter on `git push --force origin main` shows a
  confirmation dialog with reasons. It works.
- **Command queue** popup. Queued commands run when the prompt returns.
  Works.
- **Animations**: a sleepy cat while a command runs, a red shake on failure,
  and others.
- **Request tab.** Method, URL, params, headers, body, auth and options.
  Responses show status, time, size and pretty JSON, plus a redirect-hop
  timeline and "copy as curl". It works against a local server.
- **Database tab** for SQLite and PostgreSQL: connect, schema tree, SQL
  editor with Ctrl+Enter, and a results table. Works with SQLite; see the
  NixOS note below.
- **Settings tab**: 11 colour schemes as preview cards; window theme, font,
  cursor, terminal and assistant toggles; animation choices and custom CSS;
  rebindable shortcuts, recorded by pressing keys.
- **Command palette** (Ctrl+Shift+P) with fuzzy search, plus modes for
  history search, ask, and find in scrollback. Also an insights dialog
  (k-means workflows and stats), toasts, and a confirm-close dialog.

## The flood stall: found and fixed (2026-10-24)

`seq 1 200000` stalled about half the time. It was never the scheduler. A
`vm.dump!` taken during the stall showed the session process **failed**:
`out_of_memory`, its heap past 1 GiB. Nothing joined or monitored it, so it
died silently, and the reader waited for a `:taken` that never came. The
traced runs looked like a lost wake-up only because the harness read the
backend's stderr at exit: the `R`/`S` tracing filled the 64 KiB pipe, and the
session blocked in `write(2)` right after a trace line.

The memory was a VM leak in trunks. A slice of a root (`drop`, `rest`, `take`)
narrowed the root but kept the store's whole written range, and `grow_to`
carried all of it on. So a queue (pushed at the back, dropped at the front),
which is what sleep's history is, kept every row ever pushed: 605 MB live at
200,000 lines with 5,000 kept. Fixed in `dream/src/trunk.cpp`: a slice gets
a store of its own once the slots outside it outnumber those in it. While
there, `trunk_concat` past the root's end grows once and writes behind one
version, where it had made a version object per element. Now 87 MB, flat;
written up in `dream/docs/notes/trunks.md`, "A queue kept everything it was
given". The same leak affected `std.sql` pools and `std.http.h2`.

In sleep:
- The session runs under `guarded!`. A failure is logged, the pty closed,
  the window sent `exit` with code -1, and the reader let go.
- `handle!` forces `term.feed` as each piece arrives (`strict! t`).
  Unforced, the state held a chain of suspensions, one per piece, until a
  frame forced it all.
- The `R`/`S` tracing is gone.

Twelve runs in a row finish, in about 6.7 s each. That is slower than the
"4 s" of before, which came from drawing 7 frames in 4 s: the lazy chain
meant most lines were never sent. Now about 145 frames are drawn and every
line within the window's 2,000 reaches it. The emulator is the cost (item 8
below).

## What changed, by repository (all uncommitted)

### dream (the VM): `dream/src`
- **`os.cpp`**: new natives on `std.os`:
  - `pty_spawn!`, `pty_resize!`, `pty_status!`, `pty_signal!` and
    `pty_foreground!`.
  - Spawning forks, uses only async-signal-safe calls in the child, uses
    `TIOCSCTTY`, and reports `execve` errors back through a close-on-exec
    pipe. The parent holds the slave open until the child has exec'd.
  - Only children it spawned can be signalled or reaped (`Ptys`).
  - Guarded by `DREAM_NO_PTY` on Windows and Emscripten.
- **`io.cpp` and `io.hpp`**: `io_adopt_stream` and `io_with_fd`. `io.read!`
  answers `""` (end of file) on EIO from a terminal.
- **`graphics.cpp`**: the desktop host delivers every complete backend
  frame in one `evaluate_javascript` per pump tick, instead of one frame
  per 10 ms.
- Built with no warnings:
  - native: `nix-shell -p llvm --run 'just vm'`
  - browser: `nix-shell -p emscripten cmake --run 'cmake --build build-browser -j16'`
  - graphics: every Linux VM since GTK and WebKitGTK are found at run time
    (dream/src/graphics_api.hpp); the native build is the graphics build

### mind/std
- **`src/pty.dr`** (new): `std.pty`. `Options`, `Pty`, `Exit`, `spawn!`,
  `read!`, `write!`, `resize!`, `status!`, `wait!`, `signal!`,
  `foreground!`, `close!`, `read_all!`. Five tests pass. Registered in
  `all.dr`.
- **`src/ml/text.dr`** (new): tokens, char n-grams, `hashed`, sparse
  vectors, `cosine`, TF-IDF, `index`/`search`, and an n-gram model with
  stupid backoff. Context keys are text, because a map compares list keys
  by identity. 9 tests.
- **`src/ml/bayes.dr`** (new): multinomial naive Bayes with online
  `learn`. 4 tests.
- **`src/ml/cluster.dr`** (new): k-means++ (dense) and spherical k-means
  (sparse). 4 tests.
- **`src/list.dr`**: `map_indexed`, with a test.
- **`src/file.dr`**: `append!`, with a test.
- **`src/http/mod.dr`**: a bug fix. `with_redirects 0` now answers the
  redirect, as documented, instead of raising `:too_many_redirects`. The
  test is in `http/server.dr`.
- **`src/graphics/backend.dr`**:
  - `serve_with!` gives the commands an `Events`, and `emit!` lets a
    backend push events to the frontend.
  - A single writer process owns stdout.
  - The frame-size check happens in the sender (`post!`).
  - `spawn!` must be given a thunk: `spawn! $( f x )`, not `spawn! (f x)`.
- **`src/graphics/mod.dr`**: `ui.on_backend name f`, which is a
  `Sub.port ("backend:" + name)`.
- **`src/graphics/html.dr`**: `on_paste`, `on_compose`, and the declarative
  default-prevention attributes `prevent [events]`, `pass_keys [chords]`
  and `prevent_keys [chords]`.
- **`src/graphics/browser.dr`**: `scroll_to_end! key` and
  `selected_text! f`.
- **`src/graphics/widgets.dr`**:
  - Application widgets: `frame`, `toolbar`, `workspace`, `sidebar`,
    `panel`, `split`, `status_bar`, `nav_item`, `doc_tabs`, `kbd`, `chip`,
    `pairs`, `code_block`, `sparkline`, `mono`.
  - `Palette` with `palette`.
  - `Terminal` with `terminal`, `terminal_input`, `terminal_probe` and
    `line_key`. Lines carry absolute numbers (`first`), so scrolling keeps
    each lazy line's identity. The cursor and ghost text are absolute
    overlays sized in `ch`. Input goes through a hidden textarea.
  - About 25 new icons, an `applications` stylesheet, ANSI palette and
    terminal variables for light and dark, gutter marks drawn as
    `::before`, and labels that stay in the UI font under `.dw-mono`.
  - 15 tests pass.
- **`graphics/web/main.mjs`**: routes backend `event` frames to
  `ports.has('backend:'+key)`. `dream.send` refuses `backend:` names. New
  services `scroll_end` and `selection`.
- **`graphics/web/dom.mjs`**:
  - Events `paste` and `compositionend`.
  - Prevent and pass handling, through the `data-dream-prevent`,
    `data-dream-pass` and `data-dream-keys` attributes.
  - **Typing race fix.** An element remembers the values it reported
    (`record.sent`), and a render carrying one of them doesn't overwrite
    the field.
  - **`autofocus`** now focuses controls created after page load. It runs
    after the step that restores the previous focus.
- **`graphics/tests/dom.test.mjs`**: two new tests (the typing race and
  autofocus). 39 tests pass. Run them with
  `DREAM_JSDOM=/tmp/dream-graphics-js/node_modules/jsdom/lib/api.js node --test dom.test.mjs main.test.mjs worker.test.mjs`
  from `mind/std/graphics/tests`.

### Added 2026-10-24
- **`dream/src/trunk.cpp`**:
  - `trunk_slice` copies a slice that lets go of most of its store.
  - `trunk_concat` has a fast path past the root's end.
- **`dream/docs/notes/trunks.md`**: a new section, "A queue kept everything
  it was given".
- **`mind/std/src/trunk.dr`**: a test.
- **`mind/std/graphics/web/dom.mjs`**: a root `keydown` listener for
  `data-dream-keys`.
- **`mind/std/src/graphics/widgets.dr`**: `prevent_keys`.
- **Docs**: as in item 4.
- **`dreams/bootstrap/dreams.dream`**: reseeded.

### workspace
- `git rm -r sleep` of the old sleep lab, staged. `mind.toml` already lists
  `sleep` as a workspace member.

### sleep (new repo, in `sleep/`)
- **Manifest and breakout:**
  - `mind.toml`: `[graphics]` with frontend `src/frontend.dr`, backend
    `src/backend.dr`, and js `web/sleep.mjs`.
  - `web/sleep.mjs`: the custom-CSS `<style>`, and a WebAudio beep for the
    bell.
  - `.gitattributes` (Elixir linguist hint) and `.gitignore` (`target/`).
- **Backend, native:**
  - `term.dr`: the VT/xterm emulator. It's pure, with 15 tests.
    - Rows are char and style trunks with a `used` width. Printable ASCII is
      written in runs. Rows hold a shared `blank_row`. History is trimmed a
      tenth at a time.
    - `take_updates` only sends lines within `window` (2000).
    - Throughput is about 400 KB/s. It was 50 KB/s before optimizing.
  - `session.dr`: one terminal tab: the PTY reader, frames batched about
    every 8 ms, blocks from marks, the queue, autosuggest requests and the
    risk hold on Enter.
  - `shell.dr`: bash and zsh integration scripts, written to
    `~/.cache/sleep/shell`. Both pass `bash -n` and `zsh -n`.
  - `assist.dr`: the assistant process. It loads history in the
    background, learns from each finished command, retrains the network
    every 150 commands, and answers calls.
  - `requests.dr`: the HTTP debugger, following redirects one hop at a
    time.
  - `databases.dr`: one process per connection. Connecting does a real
    schema read, so a missing library fails at connect time. Rows are keyed
    by column name (`named_rows!`). Three tests.
  - `backend.dr`: the command table. Slow work is async and answered by
    events: `http`, `db` and `insights`.
- **ML models:**
  - `history.dr`: shell history plus sleep's own JSONL log in
    `~/.local/share/sleep`.
  - `predict.dr`: the n-gram model and the MLP, `next` and `complete`.
  - `fix.dr`: noisy-channel typo correction with OSA distance.
  - `explain.dr`: the naive Bayes classifier, the table of known failures,
    and the summary.
  - `cookbook.dr`: about 550 recipes, retrieved by TF-IDF, with slots.
  - `risk.dr`: a logistic over regex features, with "allowed twice" trust.
  - `insights.dr`: durations as an EMA, workflows by k-means, and stats.
- **Shared by both sides:** `settings.dr` (`Settings` as JSON, actions and
  default chords, the animation option lists), `schemes.dr` (11 colour
  schemes) and `keys.dr` (key-to-bytes encoding, chords, bracketed paste).
- **Frontend**, on the browser VM:
  - `frontend.dr`: the main model, routing, shortcuts, palette, dialogs and
    styles.
  - `tab_terminal.dr`, `tab_request.dr`, `tab_database.dr`,
    `tab_settings.dr`, `animations.dr` and `ui_common.dr`.
- Every module has `when test` blocks, and all pass.
- Test a module with:
  `build-dream/bin/dream build/dreams.dream sleep/src/X.dr --test -L mind -L sleep/src -o /tmp/x.dream && build-dream/bin/dream /tmp/x.dream`

## Running it

- **Build:** from `sleep/`, run
  `DREAMS=$PWD/../build/dreams.dream DREAM=$PWD/../build-dream/bin/dream ../build-dream/bin/dream ../build/mind build`.
  It writes `target/debug/sleep/`.
- **Window:** `build-dream/bin/dream sleep/target/debug/sleep.dream` (WebKitGTK
  4.1 installed, or `DREAM_LIB_WEBKIT2GTK` naming it).
- **Headless screenshots:** `scratchpad/shot.sh`. It runs Xvfb `:77`, uses
  xdotool for input and ImageMagick `import` for screenshots, and needs
  `nix-shell -p xdotool imagemagick` plus a sandbox-free shell.
  - Set `GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1`.
  - Do **not** set `WEBKIT_DISABLE_COMPOSITING_MODE`: with it, the page
    renders blank.
  - Point `XDG_DATA_HOME` and `XDG_CONFIG_HOME` at the scratchpad, so tests
    don't touch the user's real history or settings.
- **Headless backend:** `scratchpad/drive*.py`, `perf.py`. They speak the
  backend's stdin/stdout protocol directly.
- **SQLite on NixOS** isn't on the library path. Run with
  `DREAM_LIB_SQLITE3=$(nix-build '<nixpkgs>' -A sqlite.out --no-out-link)/lib/libsqlite3.so`.
  Without it, the app now shows std's clear "cannot find the C library"
  error.

## TODO: done 2026-10-24

1. **Done.** The stall is fixed (see above) and the tracing removed.
2. **Done.** Ctrl+Enter is handled in `frontend.dr`'s `Msg.key` for the
   request and database tabs. The SQL editor no longer routes keys itself,
   so a query runs once. That exposed a std bug: `data-dream-keys`
   (`html.prevent_keys`) was only honoured on elements that listen for
   `keydown`. `dom.mjs` now honours it once, at the root. `w.prevent_keys`
   is a new widget modifier; the request body uses it.
3. **Done.** DOM tests for `prevent`/`pass_keys`, `prevent_keys` with no
   listener, and `paste`: 42 pass.
4. **Done.** graphics.md: "Editors and terminals", `on_paste` and
   `on_compose`, `on_backend`, `scroll_to_end!`, `selected_text!`, and
   backend events. widgets.md: the application widgets, the palette, the
   terminal, `prevent_keys`, `mono` and the icons. std's README: `pty`,
   `ml.text`, `ml.bayes` and `ml.cluster`. ml.md: "Models that learn from
   the person". The workspace `CLAUDE.md`: a `sleep/` row and a `std.pty`
   line. The notes index is updated.
5. **Done.** `sleep/README.md`.
6. **Done.**
   - `just reseed` settled in one round.
   - Passing: `test-std`, `test-examples` (25/25), `test-bootstrap`,
     `test-graphics`, `test-browser-compat`, `dream_tests` (125,467
     checks), and every sleep module's tests.
   - The native, browser and graphics VMs all rebuilt with no warnings.
   - `std.trunk` has a new test, for a slice that copies.
7. Still to tell the user: one purity error makes every std macro report
   "cannot run macro". Not fixed here.
8. **Done** (2026-10-24, after publishing). A 200,000-line flood is 0.54 s
   in the window, where it had drawn 111,000 lines after 25 s; a coloured
   one is 1.6 s where it was about 10. In the emulator: rows are runs, not
   two full-width trunks; plain and coloured lines at the foot of the
   screen are taken a run of lines at a time (`flood`); the terminal's
   rarely changed modes are a record of their own, so each change copies
   less; CSI dispatches on its final character; parameters are read a byte
   at a time. Around it: frames carry only the screen while output streams
   (`session.dr`), the widget draws lines in lazy blocks, and JSON is the
   VM's (`vm.json_encode`, `vm.json_decode`). "A stream of output" in
   dream/docs/notes/browser-vm.md. The JIT then refused any function binding
   one slot in two branches; that is fixed in the VM ("Bindings in scope"
   in dream/docs/notes/vm-performance.md), a self-compile 6% faster.
9. **Done.** Publishing, as the user asked:
   - Commit and push `dream` and `mind/std` in their own repos.
   - Create `dream-mindv2/sleep`, which needs the user's go-ahead because
     it's outward-facing (`gh repo create dream-mindv2/sleep --public`).
   - Commit `sleep` and push it.
   - Add it as a submodule at `sleep/`. The old directory's removal is
     already staged; add a `.gitmodules` entry with `branch = main`.
   - Run `just subs-bump` and commit the workspace.
   - Commit messages end with the Co-Authored-By and Claude-Session lines
     from the conversation's attribution reminder.
10. **Done** (memories saved). They were:
    - `spawn!` takes a thunk.
    - Use `list.each!` for effects.
    - Map list keys are compared by identity.
    - Only the backend's stdout is the protocol.
    - The Xvfb and WebKit compositing trap.
    - `DREAM_LIB_SQLITE3` on NixOS.
