# Feature Specification: Sticky Repository Selector

## Overview

The Repository Selector is a persistent UI element that allows users to identify and switch between Git repositories. It remains fixed at the top of the viewport while scrolling through commit lists, ensuring users always have context of which repository they're viewing.

---

## Problem Statement

### User Pain Points

1. **Context Loss During Scrolling**: When viewing long commit histories, users scroll deep into the list and lose sight of which repository they're currently viewing. This causes confusion, especially when working with multiple similar repositories.

2. **Right-Aligned Element Clipping**: The previous repository selector was positioned on the right side of the header. When commits have long messages, horizontal overflow causes the right-aligned selector to be pushed off-screen and become inaccessible.

3. **Redundant UI Elements**: The previous design had two separate elements displaying repository information—a display-only metadata component and a separate dropdown selector—creating visual clutter and wasted space.

---

## Solution

A unified, left-aligned, sticky repository selector that:
- Stays visible at all times during scrolling
- Combines display and selection functionality into a single compact element
- Positions content on the left to avoid clipping issues

---

## Feature Requirements

### FR-1: Sticky Positioning

The repository selector header must remain fixed at the top of the viewport when the user scrolls through the commit list.

**Acceptance Criteria:**
- The header does not scroll with the content
- The header remains visible regardless of scroll position
- The header appears directly below the window title bar
- A subtle bottom border visually separates the header from scrollable content

### FR-2: Repository Display

The selector displays the current repository name in a compact, single-line format.

**Acceptance Criteria:**
- Display only the folder name (final path segment), not the full path
- Example: `/Users/dev/projects/my-app` displays as `my-app`
- Text styling: medium weight, standard foreground color
- Font size: small (consistent with other UI controls)

### FR-3: Full Path Tooltip

The complete repository path is accessible via tooltip for users who need the full context.

**Acceptance Criteria:**
- Tooltip appears on hover over the repository name
- Tooltip displays the complete absolute path
- Tooltip appears instantly (no delay)
- Tooltip position: below the trigger element

### FR-4: Dropdown Interaction

Clicking the repository name opens a dropdown menu for repository selection.

**Acceptance Criteria:**
- Chevron icon indicates dropdown affordance
- Chevron rotates 180° when dropdown is open
- Click toggles dropdown open/closed
- Clicking outside the dropdown closes it
- Pressing Escape key closes the dropdown
- Hover state: subtle background highlight on the clickable area

### FR-5: Repository List

The dropdown displays all registered repositories with selection state.

**Acceptance Criteria:**
- List shows all repositories in the user's workspace
- Currently selected repository is visually highlighted
- Selected repository shows a checkmark icon
- Unselected repositories show a folder icon
- Each item displays:
  - Folder name (primary text, medium weight)
  - Full path (secondary text, muted color, smaller size)
- Maximum height with scroll for long lists (approximately 24rem)
- Empty state message when no repositories are registered

### FR-6: Repository Selection

Users can switch repositories by selecting from the dropdown.

**Acceptance Criteria:**
- Clicking a repository item selects it
- Dropdown closes after selection
- Application state updates to reflect new repository
- Selection is immediate (no confirmation required)

### FR-7: Repository Management Actions

The dropdown provides actions to add or remove repositories.

**Add Repository:**
- Button labeled "Add Repository" with plus icon
- Opens system folder picker dialog
- Selected folder is added to the repository list
- Dropdown closes after action

**Clone Repository:**
- Button labeled "Clone Repository" with download icon
- Opens clone dialog for entering repository URL
- Successfully cloned repository is automatically selected
- Dropdown closes after initiating action

**Remove Repository:**
- Each repository item has a remove button (X icon)
- Remove button appears on the right side of each item
- Clicking remove button removes repository from list
- Remove action does not delete files, only removes from app
- Remove button has destructive hover state (red tint)
- Clicking remove does not trigger repository selection

### FR-8: Worktree Badge

When the user is working in a Git worktree (not the main repository), a badge indicates this state.

**Acceptance Criteria:**
- Badge appears next to the repository name
- Badge indicates "worktree" or shows worktree path
- Badge only appears when active worktree differs from main repository path
- Compact variant styling (small, unobtrusive)

### FR-9: Forge Status Indicator

A status indicator showing the connection state to the Git forge (GitHub, GitLab, etc.) appears inline with the repository selector.

**Acceptance Criteria:**
- Indicator appears to the right of the repository name (and worktree badge if present)
- Shows current forge connection status
- Does not interfere with repository selection functionality

---

## Edge Cases

### EC-1: No Repository Selected

**Scenario:** Application launches with no repository selected or all repositories removed.

**Behavior:**
- Display placeholder text: "No repository selected"
- Muted text styling
- No dropdown functionality (nothing to show)
- User must use empty state action or menu to add repository

### EC-2: Very Long Repository Names

**Scenario:** Repository folder name is unusually long (e.g., "my-extremely-long-project-name-with-many-words").

**Behavior:**
- Name displays without truncation in the header (header accommodates width)
- Dropdown items truncate long names with ellipsis
- Full path in dropdown provides complete context
- Tooltip always shows complete path

### EC-3: Very Long Repository Paths

**Scenario:** Repository is deeply nested (e.g., "/Users/developer/work/client/project/submodule/component").

**Behavior:**
- Header shows only folder name (last segment)
- Tooltip shows complete path
- Dropdown items truncate paths with ellipsis
- Paths truncate from the beginning to preserve the folder name

### EC-4: Many Repositories

**Scenario:** User has 20+ repositories registered.

**Behavior:**
- Dropdown becomes scrollable after reaching maximum height
- Scroll container has maximum height of approximately 24rem (384px)
- Scrollbar appears when content exceeds container
- Current selection remains visible/scrolled into view when dropdown opens

### EC-5: Single Repository

**Scenario:** User has only one repository registered.

**Behavior:**
- Dropdown still functions normally
- User can still access Add/Clone/Remove actions
- No special handling required

### EC-6: Rapid Repository Switching

**Scenario:** User quickly switches between repositories multiple times.

**Behavior:**
- Each selection triggers immediate state update
- No debouncing or throttling on selection
- Previous async operations (if any) are superseded by new selection

### EC-7: Repository Removal While Selected

**Scenario:** User removes the currently selected repository.

**Behavior:**
- Repository is removed from list
- Application handles the orphaned selection state
- May fall back to no selection or first available repository (implementation dependent)

### EC-8: Failed Repository Operations

**Scenario:** Adding or cloning a repository fails (invalid path, network error, etc.).

**Behavior:**
- Error feedback provided via toast notification
- Dropdown may remain open or close (implementation dependent)
- Existing repository list unchanged
- User can retry operation

### EC-9: Dropdown Positioning Near Viewport Edges

**Scenario:** Dropdown would extend beyond viewport boundaries.

**Behavior:**
- Dropdown repositions to stay within viewport
- If no room below, dropdown may appear above trigger
- If no room on right, dropdown shifts left
- Minimum padding from viewport edges (8px)

### EC-10: Keyboard Accessibility

**Scenario:** User navigates via keyboard.

**Behavior:**
- Trigger button is focusable via Tab
- Enter/Space opens dropdown
- Escape closes dropdown
- Focus management follows accessibility best practices

### EC-11: Tooltip and Dropdown Conflict

**Scenario:** User hovers to see tooltip then clicks to open dropdown.

**Behavior:**
- Tooltip hides when dropdown opens
- Tooltip does not interfere with dropdown interaction
- Only one overlay (tooltip or dropdown) visible at a time

### EC-12: Window Resize

**Scenario:** User resizes application window while dropdown is open.

**Behavior:**
- Dropdown repositions if necessary
- Dropdown remains functional
- No visual glitches or orphaned elements

---

## Visual Specifications

### Layout Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│ Window Title Bar (drag region)                          │
├─────────────────────────────────────────────────────────┤
│ [repo-name ▾] [worktree-badge] [forge-status]          │  ← Sticky Header
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Scrollable Commit List                                 │
│                                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Dropdown Structure

```
┌─────────────────────────────────────┐
│ ◉ selected-repo                     │  ← Highlighted
│   /full/path/to/selected-repo     │
├─────────────────────────────────────┤
│ 📁 other-repo                    ✕ │
│   /full/path/to/other-repo        │
├─────────────────────────────────────┤
│ 📁 another-repo                  ✕ │
│   /path/to/another-repo           │
├─────────────────────────────────────┤
│ ＋ Add Repository                   │
│ ⬇ Clone Repository                 │
└─────────────────────────────────────┘
```

### Spacing and Sizing

- Header vertical padding: 8px (0.5rem)
- Header horizontal padding: 24px (1.5rem)
- Dropdown width: 320px (20rem)
- Dropdown item padding: 8px vertical, 16px horizontal
- Dropdown maximum height: 384px (24rem)
- Icon sizes: 16px (1rem) for list icons, 14px (0.875rem) for chevron
- Border radius: 6px for buttons, 8px for dropdown

### Interactive States

**Trigger Button:**
- Default: No background
- Hover: Subtle muted background
- Active/Open: Same as hover

**Dropdown Items:**
- Default: No background
- Hover: Muted background
- Selected: Accent background tint (20% opacity)

**Remove Button:**
- Default: Muted foreground color
- Hover: Destructive color with light destructive background

---

## Dependencies

- Tooltip component with configurable delay (0ms for instant)
- Popover/Dropdown component with portal rendering
- Icon library (folder, checkmark, chevron, plus, download, X)
- Toast notification system for error feedback
- System folder picker API
- Clone dialog component

---

## Out of Scope

- Repository search/filter functionality
- Repository sorting or ordering
- Repository grouping or categorization
- Repository metadata editing
- Drag-and-drop reordering
- Repository favorites or pinning
- Recent repositories section
