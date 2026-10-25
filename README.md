# sleep

A terminal, written in Dream: a real shell on a pseudo-terminal, tabs for
HTTP requests and databases beside the terminals, a queue for the commands
you want to run next, and an assistant that learns how you work from your own
history -- on your machine, from nothing trained anywhere else.

The window is a `std.graphics.widgets` application, and every byte of the
terminal is Dream: the VT/xterm emulator (`src/term.dr`), the shell
integration, the models. The only native part is the VM.

## What it does

**Terminals.** Your shell on a pseudo-terminal (`std.pty`), with 16, 256 and
24-bit colour, the alternate screen (`less`, `vim`, `htop`), DEC line
drawing, bracketed paste, and the title and working directory programs set
(OSC 0/2 and 7). With shell integration -- bash and zsh, injected when the
shell starts, nothing to install -- each command is a **block**: the gutter
marks where it started and how it ended, and the window knows its exit
status, how long it took and where its output is.

**The command queue.** While a command runs, queue the next ones:
Ctrl+Shift+Q, or the toolbar's button, opens an entry in the top right.
Queued commands run one after another as the prompt comes back.

**Request tabs** (Ctrl+Shift+R) send and debug HTTP: method, URL, query
parameters, headers, a body (JSON, text or a form), bearer or basic auth,
redirects followed or not, a timeout, and certificates checked or not. A
response shows its status, time, size, headers and body -- JSON pretty
printed -- and every redirect hop on the way. Ctrl+Enter anywhere in the tab
sends it, and "copy as curl" gives you the same request for a shell.

**Database tabs** (Ctrl+Shift+D) connect to SQLite or PostgreSQL, show the
tables and their columns, and run the SQL in the editor: Ctrl+Enter anywhere
in the tab. Click a table for its first rows. Queries are kept to be run
again.

**Settings** (Ctrl+,): eleven colour schemes, shown as previews and changed
in one click -- Sleep Dark and Light, Dracula, Nord, Tokyo Night, Catppuccin
Mocha, Gruvbox Dark, One Dark, Solarized Dark and Light, GitHub Light; the
window's theme, the font, its size and the cursor; the shell, scrollback and
integration; the assistant's parts one by one; and every shortcut, rebound by
pressing the keys you want.

**Animations**, small and optional, for the moments a terminal makes you
wait: a sleepy cat (or orbiting dots, a comet, an aurora, a little wave, an
hourglass) while a command runs, sparkles when one succeeds, a shake when it
fails, confetti when a long one finishes, a ripple for the bell. Each moment
has its own choice, and your own CSS can restyle any of them or add more
(Settings → Animations).

**The command palette** (Ctrl+Shift+P) finds any action by fuzzy search, and
has modes for your history (Ctrl+Shift+H), asking for a command in words
(Ctrl+Shift+Space) and finding text in the scrollback (Ctrl+Shift+F).

## The assistant

The sidebar (Ctrl+Shift+A) is where what sleep has learned shows. Each part
is a small model chosen for the question it answers, and each can be turned
off in Settings.

| | What it is | Why that model |
|---|---|---|
| **Next, probably** | an n-gram model of commands (order 3) blended with a small network trained by `ml.fit!` in the background, on hashed features of the last two commands, the directory and the hour | the n-gram model learns from a single example but cannot generalize; the network generalizes but needs hundreds. The blend weighs the network by how it does on commands it was not trained on, so an untrained one is not listened to. About 36% of next commands right on a 2,100-line history |
| **Ghost text** | the end of what you are typing, from your history, ranked by the n-gram model in this context, how often and how recently; → accepts it | completion is a different question from prediction: how this line ends, not what comes next |
| **Did you mean** | a noisy-channel corrector: the program you meant is the one that makes `P(meant) × P(typed \| meant)` largest, edits counted with swapped neighbours as one (`gti` → `git`), subcommands too (`git psuh`) | `P(meant)` is learned from what you run, so it corrects towards your tools, not a dictionary's |
| **Why it failed** | a naive Bayes classifier marks the output lines that matter; a table of common failures, matched by pattern and by TF-IDF similarity, says what they mean and the usual fix | naive Bayes learns one example at a time from your own failures, and its answers can be explained; similarity finds a failure worded a little differently from the table's |
| **Ask** | "find files bigger than 100 MB": about a hundred recipes, retrieved by TF-IDF over words and character trigrams, with the holes -- sizes, ports, names, branches -- filled from the question | retrieval over a cookbook answers with a command you can read before running; it never runs anything |
| **Risk guard** | Enter on `rm -rf ~` or `git push --force origin main` asks first, with the reasons: a logistic model over what the command is, what it is aimed at and how it is run | the weights are set by hand, the honest choice for a model whose positive examples are disasters; a command you allow twice is trusted from then on |
| **Insights** | what you run, what fails, where the time goes; your workflows, found by spherical k-means over the commands, and how long each kind of command usually takes | a workflow is a cluster: no one has to declare it |

The models are `src/predict.dr`, `fix.dr`, `explain.dr`, `cookbook.dr`,
`risk.dr` and `insights.dr`, on `std.ml.text`, `std.ml.bayes`,
`std.ml.cluster` and `std.ml.nn`; `src/assist.dr` is the process that keeps
them, learning as each command finishes and retraining the network every 150.

## Building and running

From the workspace, with the VM and the compiler built (`just`):

```sh
cd sleep
DREAMS=$PWD/../build/dreams.dream DREAM=$PWD/../build-dream/bin/dream \
    ../build-dream/bin/dream ../build/mind build      # target/debug/sleep
../build-graphics/bin/dream --graphics target/debug/sleep
```

The window needs the graphics VM (`just graphics-vm`, GTK and WebKitGTK).
`mind run --desktop` builds and opens it in one step.

Each module's tests:

```sh
build-dream/bin/dream build/dreams.dream sleep/src/term.dr --test -L mind -L sleep/src -o /tmp/t.dream \
    && build-dream/bin/dream /tmp/t.dream
```

On NixOS, SQLite is not on the library path; point the VM at it:
`DREAM_LIB_SQLITE3=$(nix-build '<nixpkgs>' -A sqlite.out --no-out-link)/lib/libsqlite3.so`.
Without it, a SQLite tab says it cannot find the library.

## Where it keeps things

| | |
|---|---|
| `$XDG_CONFIG_HOME/sleep` (`~/.config/sleep`) | settings, as JSON |
| `$XDG_DATA_HOME/sleep/history.jsonl` (`~/.local/share/sleep`) | every command sleep saw finish: where it ran, how it ended, how long it took |
| `$XDG_CACHE_HOME/sleep/shell` (`~/.cache/sleep`) | the shell integration scripts, written at start |

Nothing leaves the machine. The assistant learns from that log and from your
shell's own history files, which it reads and never writes.

## How it is put together

Two halves, as every `std.graphics` application with a backend is. The
**frontend** (`src/frontend.dr` and `tab_*.dr`) is the window, on the browser
VM. The **backend** (`src/backend.dr`) is native and owns everything with
side effects: one process per terminal session (`session.dr`) with a reader
parked on its pseudo-terminal, the assistant, the HTTP client, a process per
database connection. The frontend asks through commands; the backend answers,
and pushes what happens -- output, blocks, a finished query -- as events.

A terminal session feeds output to the emulator as it arrives and sends the
window what changed at most every 8 ms -- while output streams, only the
screen, and the history it scrolled past once it stops, so a flood is drawn
as fast as the program writes it. The reader waits for each piece to be
taken before reading the next, so a flood of output fills the kernel's buffer
and the program writing it waits, as on any terminal, rather than queueing
ahead of your Ctrl-C.
