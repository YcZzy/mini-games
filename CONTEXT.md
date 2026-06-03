# Mini Games

This context defines player-facing language for the web games collection.

## Language

**Minesweeper**:
The classic single-player grid puzzle where the player reveals safe cells and marks suspected mines.
_Avoid_: Mine-clearance mode, bomb puzzle

**Classic Minesweeper difficulties**:
The three fixed Minesweeper presets: Beginner is 9 by 9 with 10 mines, Intermediate is 16 by 16 with 40 mines, and Expert is 30 by 16 with 99 mines.
_Avoid_: Custom minefield, freeform difficulty

**Safe first reveal**:
The Minesweeper opening rule where the player's first revealed cell and its surrounding neighbors contain no mines.
_Avoid_: First-click mine, only center-cell safety

**Flag mark**:
The only marker the player can place on an unrevealed Minesweeper cell to indicate a suspected mine.
_Avoid_: Question mark, multi-state marker

**Number quick reveal**:
The Minesweeper shortcut where clicking a revealed number cell reveals its surrounding unflagged cells when the adjacent flag count matches the number.
_Avoid_: Manual-only reveal, disabled chording

**Safe-cell victory**:
The Minesweeper win condition where the player wins after revealing every non-mine cell; correctly flagging every mine is not required.
_Avoid_: Flag-only victory, requiring all mines to be marked

**Minesweeper controls**:
The player input model for Minesweeper: desktop uses reveal, flag mark, and number quick reveal; mobile uses tap to reveal, long press for flag mark, and tap on revealed numbers for number quick reveal.
_Avoid_: Mobile flag mode, question-mark toggle

**Minesweeper best time**:
The local per-difficulty fastest winning time for Minesweeper. Timing starts on the first revealed cell and failed games do not update the record.
_Avoid_: Online leaderboard, counting pre-game time

**Mobile minefield layout**:
The touch-screen layout for Minesweeper boards. Beginner should fit the screen when practical, while larger Classic Minesweeper difficulties keep playable cell sizes and allow horizontal scrolling.
_Avoid_: Tiny full-board scaling, forcing Expert onto one phone screen

**Mobile Tetris controls**:
The touch-screen control set for Tetris. It includes left, right, down, hard drop, Hold, and rotate controls, and is intentionally smaller than the desktop keyboard control set.
_Avoid_: Full keyboard controls, hidden gesture controls

**Mobile down control**:
The down control in Mobile Tetris controls. A tap moves the active piece down by one row, while a long press repeatedly soft-drops it until released or until normal lock timing takes over.
_Avoid_: Hidden hard drop, instant lock

**Mobile hard drop**:
The dedicated hard drop button in Mobile Tetris controls. It sits below the Mobile down control in the bottom-right action cluster.
_Avoid_: Hidden hard drop gesture, replacing the down control

**Mobile Tetris information panel**:
The compact right-side status area for mobile Tetris. It uses English labels and shows one Next piece, the Hold piece, Score, Lines, Level, and a small pause entry.
_Avoid_: Desktop stats panel, full Next queue

**Mobile play layout**:
The portrait mobile arrangement for Tetris. It places the board on the left, the Mobile Tetris information panel on the right, and movement/action controls along the bottom without covering the board.
_Avoid_: Centered-board mobile layout, desktop column stack

**Mobile landscape fallback**:
The touch-screen landscape arrangement for Tetris. It only needs to remain playable and should not drive the portrait mobile design.
_Avoid_: Portrait redesign scope, reference-image layout

**Mobile preview stack**:
The preview area inside the Mobile Tetris information panel. It places the single Next piece above the Hold piece.
_Avoid_: Side-by-side previews, full Next queue

**Mobile Hold control**:
The Hold control in Mobile Tetris controls. Its action button sits above the rotation control, while its piece preview belongs with the Next preview.
_Avoid_: Hidden Hold gesture, side-by-side Hold and rotate pair

**Mobile action controls**:
The bottom-right action cluster in Mobile Tetris controls. It places the Mobile down control above hard drop, with Hold stacked above rotate beside it.
_Avoid_: Pause button, side-by-side Hold and rotate pair

**Mobile movement controls**:
The bottom-left movement pair in Mobile Tetris controls. It places left and right in a single row with a visible empty gap between them.
_Avoid_: Direction pad, filling the middle gap

**Mobile pause entry**:
The pause control for mobile Tetris. It belongs with the information panel rather than the piece movement controls.
_Avoid_: Bottom pause button, movement control

## Example Dialogue

Developer: Should mobile Tetris mirror every keyboard action?

Domain expert: No. Mobile Tetris controls should stay compact: left, right, down, hard drop, Hold, and rotate, while keeping left and right separated by an empty gap.

Developer: Is Minesweeper a mode inside another game?

Domain expert: No. Minesweeper is a standalone grid puzzle in the games collection.

Developer: Should Minesweeper let the player define arbitrary board sizes?

Domain expert: No. Classic Minesweeper difficulties are the supported difficulty set: Beginner, Intermediate, and Expert.

Developer: Can the first Minesweeper reveal be a mine?

Domain expert: No. Safe first reveal keeps the first cell and its surrounding neighbors free of mines.

Developer: Should Minesweeper include a question-mark marker?

Domain expert: No. Flag mark is the only marker for suspected mines.

Developer: Should revealed number cells support a shortcut reveal?

Domain expert: Yes. Number quick reveal opens surrounding unflagged cells when the surrounding flag count matches the number.

Developer: Does Minesweeper require every mine to be flagged before the player can win?

Domain expert: No. Safe-cell victory only requires every non-mine cell to be revealed.

Developer: Should mobile Minesweeper use a separate flag mode?

Domain expert: No. Minesweeper controls use long press for flag mark on mobile and right click for flag mark on desktop.

Developer: Should Minesweeper keep a best score?

Domain expert: Yes. Minesweeper best time is saved locally per difficulty after a win, with timing starting on the first reveal.

Developer: Should Expert Minesweeper shrink to fit on mobile?

Domain expert: No. Mobile minefield layout keeps cells playable and allows horizontal scrolling for larger boards.

Developer: Should the mobile status area include Best score and Combo Max?

Domain expert: No. The mobile Tetris information panel should show one Next piece, the Hold piece, Score, Lines, Level, and pause, using English labels.

Developer: Should portrait mobile keep the board centered above stacked panels?

Domain expert: No. The Mobile play layout places the board on the left and the information panel on the right.

Developer: Should this portrait mobile redesign also define mobile landscape?

Domain expert: No. Mobile landscape fallback only needs to remain playable.

Developer: Should Next and Hold previews sit side by side?

Domain expert: No. The Mobile preview stack places Next above Hold.

Developer: Should holding down on mobile instantly hard-drop and lock the piece?

Domain expert: No. The Mobile down control is a repeat soft drop, not a hidden hard drop.

Developer: Should mobile include a separate hard drop action?

Domain expert: Yes. Mobile hard drop is a dedicated bottom action button under the down button, not a down-button gesture.

Developer: Is pause one of the bottom movement controls on mobile?

Domain expert: No. The Mobile pause entry belongs in the information panel.

Developer: Where does Mobile Hold belong?

Domain expert: The Mobile Hold control button sits above rotate, and the Hold preview sits with Next.

Developer: Should Hold and rotate be stacked vertically on mobile?

Domain expert: Yes. Mobile action controls place down above hard drop, beside the Hold-above-rotate stack.
