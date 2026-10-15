# Formwright

A form builder for phone and desktop, running on Firebase.

- **Form designer** with 26 field types: text, long text, email, phone, website, location, whole number, decimal, currency, percent, rating, slider, calculation, date, time, date and time, yes/no, dropdown, single choice, multiple choice, file upload, photo, signature, color, link to record, and section heading.
  - Each form's row in the designer has **+ Add**, for adding a record to any form, including hidden ones that have no place in the sidebar. Saving returns to the designer.
- **Sidebar control**: choose which forms appear in the sidebar. Hidden forms stay reachable from their parent records.
- **Related forms**: parent/child forms ("Add project" from a client), with optional copying of matching fields, plus "Link to record" lookups.
- **Calculations**: formulas such as `ROUND({Budget} * 1.13, 2)`, `IF(...)`, `DAYS({Due}, TODAY())`, and `CHILDSUM("Projects", "Budget")`.
- **Security groups**: per-form *view* and *edit* levels of **none**, **own** (records the person created) or **all**. Firestore and Storage security rules enforce them.

Plain JavaScript modules, built with Vite. The only runtime dependency is the Firebase JS SDK.

- **Cadence tasks**: each record lists the Cadence tasks linked to it that you own or are assigned. Tick them off, open them in Cadence, or **Add task** to start one already linked.

Formwright runs on **Cadence's Firebase project (`tasks-2ae9d`)**, with the same accounts, and deploys to its own Hosting site. The security rules, indexes and Cloud Functions for both apps live in the Cadence folder and deploy from there. This repo deploys only its web pages.

---

## How permissions work

| Role | What they can do |
|---|---|
| **Administrator** | Everything: design forms, manage groups and users, see and edit every record. |
| **Member** | Only what their security groups allow. A member with no groups sees nothing. |

Each **security group** has a default level for every form, plus optional per-form exceptions. Each level has two parts:

| | none | own | all |
|---|---|---|---|
| **Can see** | hidden | records they created | every record |
| **Can edit** (create, change, delete) | read only | records they created | every record |

The designer offers presets: *View and edit all*, *View and edit mine only*, *View all, edit mine*, *View all, read only*, and *No access*.

When a person belongs to several groups, the most generous level wins, form by form. Editing implies seeing.

### How it is enforced

1. When an admin saves a group or changes someone's groups, the admin's browser computes that person's **effective access**. It writes the result to `users/{uid}.access`, for example `{ "*": {view:"own", edit:"own"}, "f_clients": {view:"all", edit:"none"} }`.
2. The Firestore rules (in the Cadence folder) read that map on every request.
   - A member may read a record only if they have `all`, or `own` and they are the `ownerId`.
   - They may write under the same test against their edit level.
   - `ownerId`, `createdBy` and `formId` can never change after creation.
   - `updatedBy` must be the caller.
3. The Storage rules (also in the Cadence folder) apply the same map to uploads at `uploads/{formId}/{uploaderUid}/…`, using cross-service rules.
4. Only admins can write `forms`, `groups`, or anyone's `role`, `groups` or `access`. New accounts must start as members with no access.

The UI hides what a person can't do (New buttons, Save, the designer). The rules are the real boundary.

---

## Project layout

```
index.html                 App shell
src/
  main.js                  Waits for sign-in, creates the account, starts the app
  firebase.js              Firebase init from .env.local; emulator switch
  store.js                 Firestore subscriptions and writes, Storage uploads, group/access writes
  access.js                Permission model (pure; mirrored by the rules)
  formulas.js              Formula parser and evaluator (no eval)
  workflow.js              Workflow stages: what each shows, who works on it, checks (pure, unit-tested)
  wfdesign.js              Form designer → Workflow tab
  route.js                 Web addresses for records, form lists and reports (pure)
  dash.js, dash.css        Reports and dashboards screens (charts reuse reports.css)
  dashlogic.js             Report types, filters, periods, sharing, moving old reports (pure, unit-tested)
  reportlogic.js           Field joins, totals, time buckets and the gap-free grid (pure, unit-tested)
  tasks.js                 Cadence task display helpers and links into Cadence (pure)
  lists.js, lists.css      Records list: saved views, columns, filters, select several
  grids.css                Sub-form grids on the record page
  listlogic.js             List columns, views, sorting, filters and CSV (pure, unit-tested)
  navlogic.js              Which forms the sidebar search finds (pure, unit-tested)
  sectionlogic.js          The order of sub-forms, Tasks and child forms under a record's fields (pure, unit-tested)
  foldlogic.js             Which sections are folded on a record page (pure, unit-tested)
  attach.js, attach.css    Attach existing records to a parent, Attach to…, and Detach
  attachlogic.js           Which records can be attached, and what attaching or detaching changes (pure, unit-tested)
  imports.js, imports.css  Import screens: templates menu, choose file, match columns, check rows, history and undo
  importlogic.js           Templates, column matching, checking rows, undo plans (pure, unit-tested)
  xlsx.js                  Reads and writes .xlsx and .csv with no extra packages (unit-tested)
  audit.js, auditlogic.js  Audit trail screen; filters, wording, CSV (auditlogic pure, unit-tested)
  emaillogic.js            Email PDF: templates, addresses to suggest, checking typed ones (pure, unit-tested)
  autonum.js               Auto number: how numbers look, next number, records still to number (pure, unit-tested)
  sublogic.js, subui.js    Sections under a record: columns, sort, Show menu, task cells (sublogic pure, unit-tested)
  pdfdoc.js                Export PDF: field layout, text wrapping, table columns, file names (pure, unit-tested)
  pdfdraw.js               Export PDF: draws the document with pdf-lib (unit-tested)
  pdfexport.js             Export PDF: fetches photos, loads pdf-lib on first use, downloads the file
  exportset.js             Administration → PDF exports: company name and logo
  duplogic.js              Duplicate: which values a copy keeps (pure, unit-tested)
  rules.js                 Show/hide rules: conditions, what's hidden, required or cleared, clashes, effect on saved records (pure, unit-tested)
  rulesui.js               Form designer → Rules tab: building rules with clicks (its condition builder is reused by automations)
  autologic.js             Automations: wording and checks (pure, unit-tested)
  autos.js                 Administration → Automations: list, editor, Test run, run history
  server/recordkit.js      What the server needs to read records like the app: field text, calculations, rules, the PDF model (pure, unit-tested)
  server/entry.js          Bundled with pdfdraw.js, rules.js and emaillogic.js into the Cadence functions as fwkit.cjs
  photo.js                 Smaller photos: turns photos upright and scales them down before upload
  app.js                   Navigation, record screens, form designer
  admin.js                 Security groups and users screens (admins only)
  auth.js                  Sign-in screen: Google, email and password, password reset
  ui.js, util.js           Shared helpers
  styles.css               All styles (light and dark)
  examples.json            Example forms an admin can load from the designer
public/vendor/pdf-lib.min.js  pdf-lib 1.17.1 (MIT), served unchanged (the build skips public/); loaded only when someone exports a PDF
firebase.json, .firebaserc Firebase CLI config: Hosting only, project tasks-2ae9d
.env.example               Web app settings to copy into .env.local
tests/unit/                Formula and permission tests (node --test)
scripts/make-admin.mjs     Promote a user to administrator
scripts/build-fwkit.mjs    Rebuild the Cadence functions' copy of the record kit: node scripts/build-fwkit.mjs ../cadence/functions/fwkit.cjs
.github/workflows/deploy.yml  Test on every PR; deploy Hosting on push to main

Security rules, Storage rules, indexes and their tests live in the Cadence folder.
```

### Data model (Firestore)

| Collection | Document | Written by |
|---|---|---|
| `forms/{formId}` | `name, itemName, description, color, showInSidebar, order, titleField, fields[], children[]` | admins |
| `records/{id}` | `formId, values{fieldId: value}, parentId, parentFormId, ownerId, createdBy, createdAt, updatedAt, updatedBy`; `nums{fieldId: number}` and `autoLog[]` from the server; `stage, assignee, assigneeGroup, stageAt` with a workflow | per access; at a workflow stage only its assignee or admins (`nums`, `autoLog`: server only) |
| `records/{id}/stages/{id}` | `at, by, from, fromName, to, toName, label, comment, assignee, assigneeGroup`: stage history | whoever moves it, as themselves; never changed |
| `groups/{id}` | `name, description, access{formId or "*": {view, edit}}` | admins |
| `users/{uid}` | `email, displayName, role, groups[], access{…}, createdAt` | self on first sign-in; admins after |
| `profiles/{uid}` | `displayName` (readable by everyone signed in, for "Created by") | self |
| `listViews/{id}` | `formId, name, ownerId, shared, cols[], sort{key, dir}, filters{fieldId: [options]}, density, createdAt, updatedAt` | owner (private); admins (shared, and `dflt-<formId>`) |
| `imports/{id}` | `formId, formName, fileName, ownerId, createdAt, stamp, status, added[], updated[], counts{}, finishedAt, undoneAt, undoneBy, undo{}` | admins |
| `settings/exports` | `companyName, logo` (PNG or JPEG data URL, under 600 KB)`, updatedAt, updatedBy`: the top of exported PDFs | admins (everyone let in reads it) |
| `counters/{formId}__{fieldId}` | `next`, `years{YYYY: next}`: the next auto number | server only (admins read) |
| `audit/{id}` | `at, by, byName, area, kind, formId, formName, recordId, title, targetId, targetName, changes[{key, label, type, from, to}], note, snapshot, restoredAt, restoredBy` | server only (admins read) |
| `imports/{id}/before/{recordId}` | `values, parentId, parentFormId, updatedAt, updatedBy`: a record as it was before the import changed it | admins |

Files go to Cloud Storage. The record stores `{name, size, type, path, url}`. Signatures are stored inline as small PNG data URLs.

---

## Reports and dashboards

**Reports** and **Dashboards** are under *Insights* in the sidebar.

**A report** is one chart, table or number, saved by itself so it can go on any number of dashboards. Change it once and every dashboard that shows it updates.

- **Types:** Table, Grouped table (with subtotals), Pivot (rows × columns, like Client × Stage), Bar, Line, Area, Donut, and KPI (one number, optionally compared with the period before).
- **Data from** picks the form. A report can also use fields of the forms above it: a Line items report can group by the project's stage or the client's name. That's how sub-form rows are reported "through" their parent.
- **Value:** a count of records, or the total or average of a number field.
- **Only records where:** any number of conditions (*Stage is not Done*), joined by **and** or **or**.
- **Date for periods:** which date a dashboard's period (This month, This year…) looks at. Charts over time ignore the period; they always show the last 12 months or 26 weeks.
- **Add to dashboard** puts it on an existing dashboard or a new one. The top of the editor lists the dashboards it's on.

**The Reports and Dashboards lists** are tables. **Name** is always the first column; **Columns** adds, removes and reorders the rest (reports: Type, Data from, On dashboards, Last updated, Value, Grouped by, Split by, Over time, Conditions, Owner, Sharing, Created; dashboards: Reports, Home, Sharing, Last updated, Reports on it, Starting period, Owner, Created). The choice is kept for you on each device. One search box looks through the name and every column shown, words in any order. Click a heading to sort (again to reverse); click a row to open it. On phones each row is a card.

**A dashboard** lays out saved reports and text blocks on a grid with no gaps.

- A dashboard uses the full width beside the sidebar. Its grid is 24 squares across, and rows are as tall as a square is wide, so items keep their shape on any screen (bigger screen, bigger items). Dashboards made on the earlier 12-column grid double onto the new one when opened.
- **Edit dashboard** shows the grid as dots, one per corner:
  - **Move:** drag an item by its handle (top-left). A dashed outline shows where it will land; items in the way slide down.
  - **Resize:** drag an item's bottom-right corner. A badge shows its size in squares (columns × rows). A report is at least 3 × 3, a text block 3 × 2.
  - **Keyboard:** focus a handle; arrow keys move the item, Shift + arrow keys resize it.
  - Gaps are allowed. **Float items up** slides everything up to close vertical gaps (saved with the dashboard).
  - Add saved reports (or make a new one from there) and text blocks; new items go in the first free spot. ✕ removes an item. Press **Save dashboard** when done.
  - On phones, items stack full width in reading order (top to bottom, left to right).
  - On phones, each report is a small card: the number for a KPI, the ring for a donut (no legend), the top 5 bars with short labels, the line or area chart, and the top 3 rows of a table, grouped table (its groups) or pivot (row totals). "See all" opens the rest.
  - Tap a bar, slice or point to see its records; tap anywhere else on a card to see all of its records. Press and hold (any touch screen) for a bubble with the name, the number of records, the total and its share. A tip says so the first three times a dashboard is opened.
  - Dashboards saved before the canvas keep their arrangement as the starting layout.
- **Filters:** a period (All time, This month, Last 30 days, This quarter, This year) and any number of field filters you add while editing (*Clients › Company name*). Everyone can change them while viewing; the period picked while editing is saved as the starting one. A field filter applies to each report whose form is that form or sits below it; the others say it doesn't reach them.
- **Home:** **Set as home** on any dashboard makes it open when you start Formwright. Everyone picks their own.

**Sharing:** your reports and dashboards are private. Admins can share them with everyone or with chosen security groups. Sharing only decides who sees them in their lists; everyone sees numbers worked out from the records *they* are allowed to see, so sharing never reveals records.

**Old reports:** the first time you open the app after this update, each report canvas you made becomes a dashboard of the same name, and each of its widgets becomes a saved report. A shared report made by someone else is converted the next time its owner opens Formwright.

Stored in `reportDefs/{id}` (`name, ownerId, shared, groups, def`) and `dashboards/{id}` (`name, ownerId, shared, groups, tiles, filters`). Home is `homeDashboard` on `profiles/{uid}`. The rules are in the Cadence folder.

## Sub-forms (grids)

A child form can show **inside** its parent record as an editable grid, like line items on an invoice, instead of as separate records.

- **Set it up:** Form designer › the parent form › **Relationships**.
  - **+ New sub-form** creates a form with Description, Qty, Unit price and Amount (`{Qty} * {Unit price}`), hidden from the sidebar. Rename it and change its fields in its own editor.
  - For any child form, **Show in the … as: Grid in the record / Separate records** switches between the two. Existing children (Site visits under Projects) can be switched either way at any time; nothing about their records changes.
  - **Grid columns** picks which fields show. Long text, files, photos, signatures, locations and multiple choice open in a pop-up from their cell.
  - **Rows follow this form's access:** people who can see a parent can see its rows, and editing works the same way. On for new sub-forms. The form then shows "Follows …" in Security groups instead of its own settings. Changing this recalculates everyone's access when you save the form.
  - Sub-forms go one level deep: a form shown as a grid can't hold grids itself.
- **On the record:** type straight into the cells. Click a heading to sort (again to reverse). **+ Add** puts a new row at the bottom, where it stays until you save. ✕ removes a row (it's deleted when you save; Discard brings it back). ↗ opens a row on its own screen.
- **Saving:** one Save writes the record and every new, changed or removed row together. Rows are checked first (required fields and so on) and problems are listed under the grid.
- **Calculations:** row calculations work as you type (`{Qty} * {Unit price}`), and so do the parent's `CHILDSUM("Line items", "Amount")`, `CHILDCOUNT(…)` and friends. A row's `PARENT("Field")` sees the parent's unsaved values too. Number columns get a total row.
- **Data:** each row is an ordinary record of the sub-form, with `parentId` pointing at the parent. So rows can be listed, filtered and reported on by themselves, and reports on them can use the parent's fields.
- Deleting a parent keeps its rows, as with any child records.

### Attaching existing records

Records made on their own (imported line items, say) can be put under a parent later, for any child form, grid or separate records.

- **Attach existing** (under a grid, or in a child section's header) opens a window of the child form's records. Tick, **Attach**. Records already under another parent (of any form) show where they are under **Currently on**; attaching those moves them, and the window says from where.
- **Suggested match:** when the parent and child have a field with the same name (Invoice # on both), the window opens filtered to the child records whose value matches this parent's, for example **Invoice # is 1**. The parent's title field is tried first, then other text and number fields, then dates, then choices. ✕ removes it and a link puts it back.
- **+ Filter** narrows by any field (not long text, files or photos), picking from the values that exist, with counts; dates go by month. Filters stack. **Search** looks through every field, long text included, and the parent's name, with words in any order.
- With no filter or search, the window shows only records that aren't on any parent; **Include … attached elsewhere** shows the rest. A suggested match, a filter or a search always looks at all of them.
- In a **grid**, attached rows are saved with the parent, so they also work on a new parent before its first save; Discard undoes them. For **separate records**, attaching saves straight away.
- **Detach** (the broken-link button on a row or card) takes a record off its parent without deleting it, so it shows up as unattached again. In a grid it happens when you save.
- From a child form's **list**: tick records, **Attach to…**, pick the parent. When a same-named field matches, the parent that matches the most ticked records is suggested at the top, and picked for you when it matches all of them.
- With **Copy matching fields** on, attaching fills matching fields that are empty on the child; it never overwrites. "Link to record" fields that point at the parent's form follow the move, and are cleared on detach. Calculations that use `PARENT(…)` are worked out again.
- You need edit rights on the parent and on the records being attached. Access is per form, so attaching or detaching doesn't change who can see a record.

## Records lists

The sidebar doesn't list forms. Click or tap **Search forms** under Forms and a pop-up lists every form you can open there, in sidebar order; typing narrows it (any part of the name, any case; ↑ ↓ to choose, Esc or clicking elsewhere closes). Clicking a form's **name** (or Enter) starts a new record on it ("+ New" shows on hover); forms you can only view open their list instead. The **count** beside it, a small rounded box, opens the records list (or Shift+Enter). Child and sub-forms are left out unless they're switched on for the sidebar in the form designer, so that switch now decides what a search can find. For the full list, use the form designer.

Under a record's fields come its sub-form grids, Tasks and child forms. Their order is set per form in the designer: **Fields** tab › **Under the fields**, by dragging a card by its handle or with ↑ ↓ (saved as `sectionOrder` on the form; fields always come first for now). New sub-forms and child forms join next to their kind.

In the designer, fields and section cards move by dragging their handle (⠿), with a mouse or a finger; only the handle starts a drag, so scrolling never moves anything. With a handle focused, the up and down arrow keys move it one place. Field types are added by tapping them, or by dragging them onto the form with a mouse.

In the Form designer, **Search forms by name** above the list narrows it as you type (names only, any case, child and sub-forms included); the reorder arrows hide while it's in use, and Esc clears it.

In the form editor, **Search field types** at the top of the field types filters as you type (other words work too: "money" finds Currency, "lookup" finds Link to record); **Enter** adds the first match.

On a record, **Delete**, **History**, **Duplicate**, **Email PDF**, **Export PDF**, **Back** and **Save** (those you can use) sit in a bar at the top that stays in view as you scroll; who created and last edited the record is under its title.

On a record, **Section Heading** fields, sub-form grids, child sections and **Tasks** fold and open from their headings (a folded one shows a short summary, such as a grid's totals); **Collapse all / Expand all** is at the top. Everything starts open. What you fold is remembered for each form (folding Notes on one invoice folds it on every invoice), for your account on that device. A section with a problem to fix opens by itself when you save.

A sub-form grid, child section or Tasks section with more than 5 entries gets a search box. Tasks are found by title, notes, people, due date (or “done”), repeat and subtasks. A grid searches across its columns; a child section searches every field of its records. Words can be in any order. New grid rows, and rows with a problem to fix, always show; the grid's totals still cover every row.

**Back button:** every screen you open is a step in the browser's history, so the phone's back button or gesture and the browser's Back go one screen back, the same as the in-app Back button (Forward works too). Back closes an open pop-up or the phone menu first, and with unsaved changes it asks first ("Tap again to leave without saving"). On the first screen, Back shows **Press back again to exit**; a second Back within a few seconds leaves.

**Theme:** the button beside your name at the bottom of the sidebar steps through **Auto** (follows the device's light or dark setting), **Light** and **Dark**. The choice is kept on each device, so a computer and a phone can differ. It's applied before the page draws, so there's no flash of the wrong colours, and the phone's browser bar follows it.

**Currency:** a Currency field, or a calculation shown as Currency, with no currency code set counts as **CAD**, matching what the form designer shows.

Every screen uses the width it has, up to 1,600 pixels (dashboards use all of it); phones are unchanged.

Sorting goes by the real value everywhere (lists, grids, report tables, drill-downs): dates and times by calendar, numbers by size, text in natural order (Item 2 before Item 10), blanks last. That includes a record's title column when the title field is a date or a number, the parent column, and "Link to record" columns.

Each form's list can be set up from the list itself.

- **Columns:** **Columns** opens a picker. Tick fields to show them and use the arrows to reorder. Besides the form's own fields, you can add the parent record (**Belongs to**), fields of the parent (Clients › Status), counts of child records (how many Site visits), and **Last updated**, **Created**, **Created by** and **Owner**. The record's title is always the first column.
- **Sort:** click a column heading; click again to reverse. Empty values always go last.
- **Filter:** **Filter** lists the form's choice fields (dropdown, single choice, multiple choice, yes/no). Tick options to show records with any of them; every field you filter must match.
- **Row height:** Comfortable or Compact.
- **Saved views:** tabs above the list. When you change anything, **Reset**, **Save view** and **Save as new view** appear.
  - The first tab, **All …**, is the form's default list. Until an admin saves it, it shows the fields with **Column in the starting list** turned on in the form designer. An admin's **Save view for everyone** changes it for everyone; **View options › Go back to the form's list columns** undoes that.
  - Your own views are private (**Just me**). Admins can also save a view for everyone, or share or unshare one under **View options**.
  - The app remembers the last view you used for each form on each device.
- **Select several:** tick rows (or **select all**, which picks only the rows shown). A bar appears with:
  - **Set field:** set a dropdown, single choice or yes/no field to the same value on all of them.
  - **Set owner** (admins): give the selected records to someone. Who created them stays as history.
  - **Export CSV:** the selected records with the columns you're showing.
  - **Delete:** asks first, then gives you about 6 seconds to **Undo** before anything is deleted. Child records stay (without a parent), and linked Cadence tasks show the record as removed. Closing the app during those seconds cancels the delete.
  - Records you aren't allowed to edit are skipped, and the bar and dialog say how many.
- **Phones:** the list shows cards with tick boxes, and menus open as a sheet at the bottom.

A view only decides how the list looks. It never shows anyone records they couldn't already see.

## Automations (administrators)

**Administration → Automations**: "when this happens, do that", for one form each. They run on the server (Cadence `functions/automate.js`), so they work whatever changed a record (the app on any device, an import, Set field, another automation) and on dates when nobody is signed in. Stored in `automations/{id}`; admins only (security rules).

- **When:** a record is **created**; **changes** (any field, a chosen field, or a field *becoming* a value: "Status becomes Approved", which fires only when it wasn't before); **reaches a date** (on a date field, or N days before or after it, checked at 7:00 a.m. Toronto time, once per record per day); or is **emailed** with Email PDF.
- **Only if:** conditions built with the same click builder as show/hide rules, including the parent record's fields. None means always.
- **Then** (up to 10 actions, in order):
  - **Set fields** on the record or its parent: a value, today, a copy of another field, or empty. Fields already as wanted aren't written (so nothing loops).
  - **Create a Cadence task** linked to the record: title and notes with `{Field}` placeholders, for the record's owner, whoever made the change, or a chosen person, due in N days. The admin who made the automation owns it; the assignee needs Cadence switched on to see it.
  - **Send an email** from the company Gmail (the Email PDF setup): to email fields on the record or its parent, the owner, chosen people and typed addresses; subject and message with placeholders; optionally **with the record's PDF**, made on the server with each section's standard columns. Listed under the record's Sent emails and in the audit trail.
  - **Create a child record** under the record, copying matching fields if wanted, plus chosen values.
- **Placeholders:** `{Field name}`, a parent's field as `{Client › Name}`, and `{Title}`, `{Item}`, `{Company}`, `{Date}`.
- **Safety:** an automation never reacts to its own change; changes made by automations can set off others up to 3 in a row, then it stops and the run log says so. Each automation has an On/Off switch, a **Test run** on a chosen record (what it would do, nothing changed or sent), and a **Run history** (each run, what it did, errors). Everything it changes is in the audit trail as "Automation: name"; records show "edited by an automation".
- **Imports and Set field** count as changes; the import check step says how many automations may run.
- **Not covered by automations:** show/hide rules aren't applied to values an automation sets (the record follows its rules next time it's saved), and calculations are worked out when the record is shown.
- **Server code from Formwright:** the functions use `fwkit.cjs`, a bundle of `src/server/`, `formulas.js`, `rules.js`, `pdfdoc.js`/`pdfdraw.js` and `emaillogic.js`, plus `functions/vendor/pdf-lib.min.js`. After changing those, run `node scripts/build-fwkit.mjs ../cadence/functions/fwkit.cjs` and deploy the functions.

**Email PDF** also has an **Attach the PDF** switch (on by default); off sends just the message.

## Workflows (stages)

**Form designer → Workflow** turns on stages for a form, like Draft → Review → Approved (a starter set is filled in). Logic in `src/workflow.js` (pure, unit-tested); the tab is `src/wfdesign.js`.

- **Each stage** has a name, who it **goes to** when a record arrives (the record's owner, a specific person, a security group, whoever moved it, or the same person as before), whether they get a **Cadence task** and/or an **email**, and its **buttons** (label → stage; "Ask why" makes the person write a comment, as on Send back). A stage with no buttons is the end.
- **Fields at each stage:** Edit, **Required** (must be filled before moving on to a later stage; saving is still allowed), **View only**, or **Hidden** (its value is kept). Hiding a section heading hides everything under it; child sections, grids and Tasks can be hidden per stage too. Show/hide rules still apply on top.
- **On the record:** a bar shows the stages, where it is, who it's waiting on and for how long, and that stage's buttons. While a record is at a stage, **only its assignee (or a member of its group) and administrators can change it**, enforced by the security rules; others see it read-only. Administrators can **Move to** any stage. New records start at the first stage when saved; records saved before the workflow was turned on (or made by an import or an automation) show **Start**.
- **Stage history** (a collapsible section on the record): every move, who made it, which button, the comment, and who it went to. Stored in `records/{id}/stages/`.
- **My work** (in the sidebar once any form has a workflow): records waiting on you or your groups, longest waiting first. Administrators can switch to **Everyone**.
- **Stage in rules and automations:** "Stage" can be picked in show/hide rule conditions and automation conditions, and automations have a **moves to a workflow stage** trigger.
- **Notices** (server, `automationOnWrite` in Cadence): when a record arrives at a stage, the previous stage's workflow tasks for it are ticked done, and the new assignee gets a task and/or email (a group: up to 10 members, each their own).
- **Record fields:** `stage`, `assignee`, `assigneeGroup`, `stageAt`.
- **Not covered:** grid rows inside a record follow the record's stage only through its sections being hidden; someone with "mine only" access sees records assigned to their group only if their normal access lets them see the record (records assigned to them personally always show).

## Show and hide rules

Each form can have rules (form designer → **Rules** tab) that change the record page as people fill it in. A rule reads like a sentence and is built from menus, never formulas:

> **When** Stage **is any of** Review, Done **and** (Clients › Status **is** Paused **or** Budget **more than** 1000) **then** hide Tasks, Estimated hours; set required Due date

- **Conditions** look at the record's own fields or its **parent** record's fields (a site visit can look at its project). Comparisons suit the field: is / is not / is any of / is none of (choices), includes (multiple choice), is Yes / is No, = ≠ more than / less than (numbers and calculations), before / after (dates), contains (text), and is empty / is not empty for everything. Join them with **all** or **any**, with one level of **groups**: (A and B) or C.
- **Actions:** **Hide**, **Show**, **Set required**, **Set not required**, **Clear value**. Several per rule, each on several things: fields, a **Section Heading** (hides every field under it), a sub-form grid, a child section, or Tasks.
- **How they combine:** Show means hidden the rest of the time; Set required means not required the rest of the time. Hide beats Show and Set required beats Set not required; a hidden field is never required. **Clear value** empties the field and locks it ("Cleared by a rule") while the rule applies. A hidden or cleared field counts as empty for other rules, so chains settle the way the record will be saved.
- **Saving:** hidden and cleared fields are emptied when the record is saved (switching back before saving brings typed values back). Hidden grids, child sections and Tasks are only hidden: nothing is deleted. Sub-form rules work per grid row (a hidden or cleared cell shows "—"), with the record on screen as the row's parent.
- **PDF exports and emails** leave out whatever the rules hide.
- **Not a permission:** hiding is layout. Lists, reports and CSV still see the data; use Security groups to restrict access.
- **Imports** apply the rules to each row as it's saved; the check step says how many values the rules will empty, on which fields. Undoing the import puts them back.
- **List "Set field":** when the new value would make rules empty fields on the selected records, it asks first ("Set Stage to Done on 2 projects? … Estimated hours: 2, Progress: 2") and does both together. For admins it's logged in Import history (**Set field: Stage → Done**) with Undo; for others it's an ordinary edit. Both are in the audit trail.
- **A parent changing:** saving a record checks its child records (separate records; grid rows are saved with the parent anyway) whose rules look at its fields. If any would change, it asks "Also update 1 site visit?" with the fields listed. **Update** empties them now (admins: logged in Import history as "Project changed (…)" with Undo); **Not now** leaves them until each is saved.
- **In the designer:** each rule shows as a sentence, with **Applies now** while it applies in **Try it** (fill in sample values, including pretend parent values, and watch fields and sections show and hide; nothing is saved). Problems are listed under the rule (a deleted field, an option that no longer exists, a rule that hides the field it looks at) and clashes at the top. Fields a rule changes are tagged "rule" on the Fields tab. Rules can be switched off, reordered and duplicated; rules about deleted fields are tidied on save. Stored as `form.rules` (see `rules.js` for the shape).
- **Changing rules on a form with saved records:** Save form works out which saved records the new rules would empty fields on and asks: **Apply to all N** empties them now, **Leave them** saves the rules and each record follows them on its next save, or **Cancel**. Applying is written like an import, so it's listed in **Import history** as a **Rule change** (filter: All / Imports / Rule changes) with **Undo** for 7 days, and every record change is in the audit trail. Undo skips records edited since. Rule edits themselves show in the audit trail as "Show and hide rules".

## Duplicating a record

**Duplicate** in a saved record's top bar (for anyone who can create records on that form) opens an unsaved copy, with its title selected so you can type the new one straight away.

- **Copied:** every typed value, choices, dates, links to records, photos and files (the copy points at the same stored photo or file; nothing is uploaded again), and the same parent. A text title gets " (copy)" added.
- **Not copied:** auto numbers (the copy gets its own when saved), signatures (they belong to one record), calculations (worked out again), child records and Tasks.
- **Sub-form grids:** their rows are copied as new rows of the copy.
- Nothing is saved until you click **Save**; Back without saving leaves no trace. A line under the title says what it's a copy of.

## Smaller photos

A **Photo** field turns the picture upright and scales it to at most 2,000 pixels on its longest side as a JPEG (quality 85%) before uploading. A 12-megapixel phone photo of about 4 MB becomes roughly 300–500 KB, so saving is quicker on mobile data, storage stays small and PDFs build faster, and it still prints sharply. The smaller copy has no location or camera details. Photos already small enough, GIFs, and pictures the browser can't read (some HEIC photos) are uploaded as they are. **File upload** fields always keep the original file exactly.

## Auto number fields

**Auto number** (Numbers group in the form designer) gives every record its own number when it's first saved: invoices, quotes, work orders, anything. Settings: **Prefix** (e.g. `INV-`), **Starting number**, **Minimum digits** (zero-padded) and **Add the year** (`INV-2026-0001`, starting again each January, Toronto time).

- **Given out by the server.** The Cadence functions (`autoNumberOnCreate`) hand out the next number from a counter in a transaction, so two saves at once, phones saving offline, imports and grid rows all get different numbers. The number shows a second or two after saving ("Being assigned…" until then).
- **Nobody can type over it.** Numbers live in `records/{id}.nums`, which the rules let only the server write. Every record save writes just the record's own fields (`setDoc` with `mergeFields`), so the number is never lost.
- **Never reused**, even after a delete. Raising the starting number moves numbering on; lowering it never goes back.
- **Existing records:** after saving the form, the field's settings show how many records have no number and **Number them now** (oldest first). Changing an existing text or number field's type to Auto number **keeps the numbers already typed in** and carries on after the highest one; clashing typed numbers are listed.
- **Admins can change a number** (record → **Change…**), with a warning. It must not be in use on the same form, the change is noted on the record (`autoLog`), and the counter moves past it so it's never handed out again.
- Works like any field elsewhere: as the record's title, list column, search, reports, CSV and PDF. Imports leave it to the server, and copying from a parent skips it.

## Audit trail (administrators)

**Administration → Audit trail** is one page with every change, newest first, kept for good:

- **Records:** created (with what was filled in), changed (each field: old → new), moved to another parent, given to another owner, deleted (with a copy), restored, and PDFs emailed. Values show the way the app shows them.
- **Admin changes:** form designs (fields added, removed, renamed or retyped, settings), security groups (access per form), accounts (first sign-in, role, groups, Cadence approval, removals), auto numbering and number changes, and PDF export settings.
- **Filters:** form, person (or System), what kind of change, from and to dates, and a search over the loaded entries. The database applies the most specific one (record, form, person, kind) with the dates; the rest are checked on what comes back. **Load more** fetches the next 100.
- **Put back** on a record change sets that field (or the parent, or the owner) back to its old value, asking again if it has changed since. It's an ordinary edit, so it's noted too. Signatures, photos, files and shortened long text can't be put back (only their names or the start are kept).
- **Restore** on a deleted record (within 90 days) brings it back with the same ID, so its grid rows, child records and links reconnect. If its parent was deleted too, it comes back on its own.
- **Export CSV**: one row per change, for what the filters show.
- **History** in a record's top bar (admins) opens the trail for just that record.

The Cadence functions write every entry (`audit/{id}`, `functions/audit.js`) as documents change, so nothing can skip it; the rules let only administrators read it and nobody write it. It needs the `audit` indexes in `firestore.indexes.json`; while they build after an install, the page says so.

## Email PDF (administrators)

**Email PDF** on a saved record sends the same PDF as Export PDF, from the company's Gmail (`GMAIL_USER` in the Cadence functions), shown with the company name from PDF exports. Replies go to the administrator who sent it.

- **To:** suggests email addresses found on the record, records it links to, its parent and grandparent, and the other children of it and its parent (a client's contacts), saying where each came from. Others can be typed. Up to 10 addresses with Cc. **Send me a copy** (on by default) blind-copies the sender.
- **Subject and message** come from the form's template (form designer → Settings → Email PDF), with `{Field name}` for any field plus `{Title}`, `{Item}`, `{Company}`, `{Sender}`, `{Date}`, and can be edited before sending. Unknown names stay as typed so a typo shows. Empty templates use standard wording.
- **Sent emails** on the record lists what was sent, to whom, by whom and when (`records/{id}/emails`, written only by the server, readable by anyone who can see the record).
- The server function `emailRecord` (Cadence folder, `functions/email.js`) checks the sender is an administrator, the addresses, the subject and the PDF (8 MB at most), allows 100 emails per person per day, then sends through Gmail with the app password kept in Secret Manager (`GMAIL_APP_PASSWORD`). Gmail also keeps a copy in its Sent folder.
- `emaillogic.js` (pure, unit-tested): templates, typed addresses, suggestions.

## Sections under a record (grids, child records, Tasks)

Each section under a record's fields has a bar at the top: a search box (once there are more than 5), **Columns**, **Show** (5, 10, 15, 20 or all; 10 to start) and its buttons (**+ Add …**, **Attach existing**, **+ Add task**). Long lists end with "Showing 10 of 34 · Show all".

- **Tables with sortable headings**, like the records lists. Click a heading to sort; again to reverse. Numbers and dates start biggest or newest first.
- **Columns** picks and orders the columns for that section. Child records offer the child form's fields, counts of its own children, and Last updated, Created, Created by and Owner; their title always comes first and they start with the form's list columns. Grids start with the columns set in the form designer. Tasks offer Due (red when overdue), Days open (from when the task was made until it was done, or today), Owner, Assigned to, Status, Repeats, Notes, Created and Done on.
- Your columns, sort and Show choice are kept per section **for you, on this device** (`localStorage` `fw.subs.<uid>`), like folded sections.
- **Search** looks through every record in the section (all fields for child records), then Show applies to the matches.
- **Grids:** new rows go at the top until you save, with the cursor in the first cell. New rows and rows with a problem always show, whatever Show is set to, and totals always cover every row.
- **Phones** show cards with a **Sort** menu instead of the table.
- `sublogic.js` (pure, unit-tested) holds the choices, limits and task cells; `subui.js` draws the bar, picker and menus.

## Export PDF

**Export PDF** in a saved record's top bar downloads it as a tidy document, for example `Site visits - Smith house.pdf`. Anyone who can see the record can export it.

- **Top:** the company name and logo from **Administration → PDF exports** (if set), then the form's name, the record's title, who created it and when, the last update, the owner, and its parent.
- **Fields** in the form's order and layout: half-width fields side by side, section headings as headings (with their help text). Values print as the app shows them: CAD currency, written-out dates, Yes/No, ratings as stars, colours as a swatch, linked records by name, calculation results. Empty fields print empty. Long text prints in full and runs onto the next page if it needs to.
- **Photos and signatures** print as pictures (photos are turned upright and scaled down). Other files are listed by name and size. A photo that can't be read prints as its name, and the message after the download says so.
- **Grids, child records and Tasks** follow as tables, in the form's section order, with the columns and sort you chose for each section on screen (every row, whatever Show is set to): grids with their totals, child records, and the Cadence tasks you can see. Long tables continue on the next page with their headings repeated. Words are never split: every column is at least as wide as its longest word, and short values (dates, amounts, codes) stay on one line; long text such as a description wraps between words. When a table is too wide, it first uses slightly smaller text, then gets landscape pages of its own (the rest stays portrait); only a single enormous word, like a long web address, can break.
- Every page has the export date, who exported it and "Page 1 of 3". Pages are US Letter.
- Unsaved changes: it asks you to save first, so the PDF matches what's saved.
- The standard PDF fonts are used, which cover English and French. Other characters (emoji, symbols, other scripts) print as `?`.

**Administration → PDF exports** (admins) sets the company name and logo. The logo is trimmed of empty space, resized and saved in `settings/exports` (PNG keeps a transparent background). The rule for it is in the Cadence folder.

**Photos need one Storage setting (CORS)** so the browser can read them into a PDF. Without it, PDFs list photos by name. See "Let PDFs include photos" under Setup.

## Importing records (admins)

Admins see **Import and templates** at the top of each form's list.

- **Templates:** an Excel file (.xlsx) with one column per field, headed with the field labels. Required fields end in `*`. Choice fields and Yes / No have dropdowns, and so do links to records when there are up to 2,000 of them. A **Guide** sheet explains every column. Calculations, files, photos and signatures are left out.
  - **Blank template:** for new records.
  - **Export with data, to update:** every record of the form, with a **Record ID** column.
  - **<Sub-form> template:** for a form that sits under this one (line items, site visits). Its second column names the parent record, by name or Record ID.
- **Import a filled-in file…:** works with .xlsx and .csv files, up to 5,000 rows at a time.
  1. **Choose file.** Old .xls and Numbers files are explained rather than refused silently.
  2. **Match columns.** Columns are matched to fields by name. Change any that are wrong, or set them to **Don't import**.
  3. **Check rows.** Nothing is saved yet. Each row is **New**, **Update**, **No change** or **Problem**. Problems say what's wrong (a choice that isn't on the list, a date that isn't a date, a client name with a typo and the closest match) and can be fixed right there. Rows that still have problems are skipped, and can be downloaded afterwards with a **Problem** column.
  4. **Import.** Saved in batches with a progress bar. Keep the tab open until it finishes.
- **How rows are read:**
  - A blank Record ID adds a new record, owned by the admin who imports it. A Record ID updates that record, and only the columns in the file change; an emptied cell clears that field.
  - Dates can be Excel dates, `2026-10-13`, `10/13/2026` or `Oct 13, 2026`. Yes / No accepts Yes, No, Y, N, True, False, 1, 0 and X. Several choices are separated with `;`. Numbers may have `$` and commas.
  - Links and parents are matched by the record's name, or by its Record ID when two records share a name.
  - Calculations are worked out as each record is saved. A new row under a parent gets the parent's values the same way **+ Add** does.
- **Import history** (also under Administration in the sidebar) lists every import. **Undo** is offered for 7 days. It removes what the import added, including rows added under those records since, and puts updated records back the way they were. Records someone has edited since the import are left alone, and the confirmation names them.

The import is admins-only in the app and in the rules (`imports/…`). The records themselves are saved through the normal record rules.

## Links and Cadence tasks

Each record and form list has its own address, so links and refreshes open the right screen:

- `#/record/<recordId>`: one record. Back goes to its form's list.
- `#/form/<formId>`: a form's records.
- `#/reports` and `#/report/<reportId>`: the Reports list and one report.

Cadence links to records this way, from the record chip on a task.

**Tasks panel.** Under each record's fields, Formwright lists the Cadence tasks linked to that record that you own or are assigned. Cadence's rules allow nothing else.

- Overdue tasks come first, then by due date. Done tasks are listed last.
- The tick box marks a task done or reopens it, writing the same fields Cadence does.
- Repeating tasks open in Cadence instead, so Cadence can create the next occurrence.
- Tapping a task opens it in Cadence (`?task=<id>`).
- **Add task** opens Cadence with a new task already linked to the record (`?addTaskFor=<recordId>`).

Set Cadence's address in `VITE_CADENCE_URL` (in `.env.local`, and as a GitHub Actions variable for deploys). Without it, the panel still lists and ticks tasks, but can't open Cadence.

The panel's query needs the `tasks` index on `members` + `recordId`. It's in Cadence's `firestore.indexes.json`.

## Setup

Formwright shares the `tasks-2ae9d` project with Cadence. Sign-in, Firestore, Storage and the rules are already set up there.

### 1. One-time setup in the Firebase console (`tasks-2ae9d`)

1. **Storage → Get started**, in the same location as the Firestore database.
2. **Hosting → Add another site** for Formwright, for example `cadence-forms`.
3. **Authentication → Settings → Authorized domains**: make sure `<site>.web.app` is listed.
4. Deploy the rules from the Cadence folder (see Cadence's README). Formwright can't read or write anything until they're live.

### 2. Run locally

```bash
npm install
cp .env.example .env.local      # paste the values from Cadence's firebase-config.js
npm run dev                     # http://localhost:5173
```

Add `http://localhost:5173`'s host (`localhost`) to authorized domains if it isn't there already. It is by default.

### 3. Make yourself the first admin

1. Sign in once with your Cadence account. This creates your `users/{uid}` document as a member.
2. Then do one of these:
   - **Console:** Firestore → `users` → your document → set `role` to `admin`.
   - **Script:** create a service account key (Project settings → Service accounts → Generate new private key), save it outside the repo, then run:
     ```bash
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run make-admin -- you@example.com
     ```
3. Reload the app. You now see **Form designer**, **Security groups** and **Users**.
4. In the designer, **Load example forms** gives you a working set to explore.

### 4. Give people access

1. People sign in once with their Cadence account (Google, or the same email and password). They then appear under **Users**.
2. Create groups under **Security groups**. For example:
   - *Office*: View and edit all.
   - *Field staff*: View and edit mine only, with Clients set to "View all, read only".
3. Add people to groups, either from the group page or the Users page.

Changes apply immediately. The person's app re-subscribes to exactly the records they may see.

### 5. Removing someone

On **Users**, **Remove…** beside a person (not yourself) asks first, naming them and how many records they own. It can't be undone.

- **Their records:** keep them under their name, shown as "Jane Smith (removed)", or pick **Give them to** someone.
- **Cadence:** tasks they own are deleted; tasks assigned to them go back to the owner, unassigned.
- **Reports, dashboards and list views:** private ones are deleted; shared ones pass to you.
- Their account, groups, private Cadence settings and push settings are deleted, then their sign-in. If they sign in again later they start as a new person with no access.

Removing runs on the server (the `removeAccount` function in the Cadence folder), so deploy the Cadence functions first. An administrator can't remove themselves, and the last administrator can't be removed.

**Removed** (below the people list) shows everyone removed and how many records they still own. **Reassign** gives all of them to someone at any time. To move only some, use **Set owner** in a records list.

---

### 6. Let PDFs include photos (once)

Photos live in Cloud Storage, which by default doesn't let web pages read files' contents. In Cloud Shell (project `tasks-2ae9d`):

```sh
gcloud storage buckets list --format="value(name)"          # shows the bucket, e.g. tasks-2ae9d.firebasestorage.app
cat > cors.json <<'JSON'
[{"origin": ["https://YOUR-FORMWRIGHT-ADDRESS"], "method": ["GET"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update gs://BUCKET-NAME --cors-file=cors.json
```

Use Formwright's address exactly as the browser shows it, with no slash at the end (add both the `.web.app` and `.firebaseapp.com` addresses if people use both). This only lets those pages read files they already have a link to; the Storage rules still decide who gets a link.

## Local development with emulators

The emulators and rules are configured in the Cadence folder. Start them there, under Formwright's demo project name:

```bash
# in the Cadence folder
npx firebase emulators:start --only auth,firestore,storage --project demo-formwright
```

Then, in this repo:

```bash
# .env.local:  VITE_USE_EMULATORS=true   (no real config needed)
npm run dev
npm run make-admin -- you@example.com --emulator
```

## Tests

```bash
npm run test:unit        # formulas, permissions, addresses, lists, dashboards and imports (no Firebase needed)
```

The security rules tests, including Formwright's, are in the Cadence folder under `tests/`.

---

## Deploying with GitHub Actions

`.github/workflows/deploy.yml` runs the unit tests and a build on every pull request. On a push to `main` it also deploys **Hosting only**, to Formwright's site. It never deploys rules: those are shared with Cadence and deploy from the Cadence folder.

### Repository settings

**Secrets** (Settings → Secrets and variables → Actions):

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | JSON key of a `tasks-2ae9d` service account with the **Firebase Hosting Admin** role. If the deploy reports a permissions error, also give it **API Keys Viewer**. |
| `VITE_FIREBASE_API_KEY` | Cadence's `apiKey`. It's not a secret, but this keeps it out of logs. |

**Variables:**

| Name | Value |
|---|---|
| `FIREBASE_PROJECT_ID` | `tasks-2ae9d` |
| `FIREBASE_HOSTING_SITE` | Formwright's Hosting site name, for example `cadence-forms` |
| `VITE_CADENCE_URL` | Cadence's address, for example `https://cadence-tasks.web.app/` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Cadence's `authDomain` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Cadence's `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Cadence's `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | Cadence's `appId` |

Create a `production` environment in GitHub if you want deploy approvals. The deploy job uses it.

Manual deploy: `FIREBASE_HOSTING_SITE=cadence-forms npm run deploy` (with your site's name).

---

## Backups

- **Automatic:** Firestore keeps a daily backup (7 days) and a weekly one (Sundays, 8 weeks). Photos and files are copied nightly to `gs://tasks-2ae9d-file-backups` (kept for good; deletions recoverable for 30 days).
- **Before every deploy:** the deploy workflows (Formwright's and Cadence's) first export the whole database to `gs://tasks-2ae9d-db-exports/before-deploy/<date>-<app>-<commit>` with `scripts/backup-db.mjs`, and stop without deploying if that fails. Cloud Shell deploys do the same with `bash deploy.sh <what>` in the Cadence folder. These copies are deleted after 90 days by a rule on the bucket.
- **Any time:** `gcloud firestore export gs://tasks-2ae9d-db-exports/$(date +%Y-%m-%d-%H%M) --project=tasks-2ae9d` makes a copy that's kept until you delete it.
- **Restoring** overwrites live documents with the same IDs, so plan it first (one collection or everything, into this database or a new one).
- The deploy account needs **Cloud Datastore Import Export Admin** on the project and **Storage Legacy Bucket Writer** on the `tasks-2ae9d-db-exports` bucket only.

## Security

- **Locked libraries.** With a `package-lock.json` in the repository, every deploy installs exactly the library versions recorded there (`npm ci`), so a hijacked new release of a library can't slip into a deploy. Without one, the workflow falls back to the newest allowed versions and shows a warning. To create or refresh it (Cloud Shell or any computer with Node 22): put `package.json` in an empty folder, run `npm install --package-lock-only --no-audit --no-fund`, and upload the `package-lock.json` it makes to the top of the repository. Update libraries on purpose, then run the tests.
- **Scripts only from this site.** The Content Security Policy in `firebase.json` lets pages run scripts only from this site and Google's sign-in and App Check services (`apis.google.com`, `www.google.com`, `www.gstatic.com`). There are no inline scripts: what used to be inline in `index.html` (the theme and the install helper) is `public/boot.js`. Text that slips into a page can't run as code, and neither can an `onerror=` style attribute.
- **No access, no app.** Anyone signed in who isn't an administrator or in at least one security group sees only a blocking screen: "You don't have access yet. Please contact an administrator.", the email they're signed in with, and **Sign out**. Nothing of the app is drawn behind it. It lifts by itself when an admin adds them to a group, and comes back at once if their access is removed.
- **Cadence is by approval.** A Formwright admin switches on **Can use Cadence** on the Users screen (`users/{uid}.cadence`); admins always can. Without it the rules refuse every Cadence task, directory, push-setting and private-item read or write, and Formwright's Tasks panel explains that Cadence isn't on for you. Cadence's sign-in creates the same starting account record Formwright does, so new Cadence people show up on the Users screen to approve.
- **New accounts see nothing** until an admin adds them to a security group: only the no-access screen, and no forms, names, shared dashboards, reports or list views. The rules enforce it; the app also waits, so a new account gets no permission errors.
- **Records** are only ever readable as the person's access allows (see How permissions work). Shared dashboards, reports and list views hold settings only, never record data.
- **Uploads:** up to 25 MB each. Web pages, SVG images, scripts and XML are refused, so a file link can't run code.
- **The site** sends security headers: no framing by other sites (stops click-jacking), no MIME sniffing, a strict referrer policy, and camera/location limited to this site.
- **App Check** (optional, recommended): set the `VITE_APPCHECK_SITE_KEY` variable to a reCAPTCHA Enterprise site key and Firebase can refuse requests that don't come from these sites. It does nothing until the key is set; enforce it in the Firebase console once requests show as verified.
- The Firebase web settings (API key and so on) are public by design. What protects data is the rules above, plus the browser-key website restrictions in Google Cloud.

## Things to know

- **Calculations only see records the person can see.** `CHILDSUM` and similar functions total the child records the viewer has access to. A "mine only" member sees totals of their own children only. Calculation results are also saved on the record when it's saved.
- **Access is recomputed by the admin's browser.** This avoids needing Cloud Functions. If a write is interrupted, Security groups → **Recalculate access** rebuilds everyone's map. A server-side alternative is a Cloud Function on `groups/*` and `users/*` writes. The rules would not change.
- **File links.** Uploads are protected by the Storage rules. The download URL saved on the record carries a token, though, so anyone who can read the record can open the file. That's the intended audience, but a forwarded link keeps working until the file is deleted.
- **Scale.** The app subscribes to every record the person can see, one query per form. That's fine into the low thousands of records per form. Beyond that, add paging and an `orderBy('updatedAt')` index.
- **Offline.** Firestore's persistent cache keeps forms and records readable without signal and queues edits. File uploads need a connection.
- **Deleting a form** deletes its records (admins only). Child records in other forms are kept.
- **Renaming a field** updates calculations that reference it, including `CHILDSUM`/`PARENT` references in related forms.
