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
  route.js                 Web addresses for records, form lists and reports (pure)
  dash.js, dash.css        Reports and dashboards screens (charts reuse reports.css)
  dashlogic.js             Report types, filters, periods, sharing, moving old reports (pure, unit-tested)
  reportlogic.js           Field joins, totals, time buckets and the gap-free grid (pure, unit-tested)
  tasks.js                 Cadence task display helpers and links into Cadence (pure)
  lists.js, lists.css      Records list: saved views, columns, filters, select several
  grids.css                Sub-form grids on the record page
  listlogic.js             List columns, views, sorting, filters and CSV (pure, unit-tested)
  attach.js, attach.css    Attach existing records to a parent, Attach to…, and Detach
  attachlogic.js           Which records can be attached, and what attaching or detaching changes (pure, unit-tested)
  imports.js, imports.css  Import screens: templates menu, choose file, match columns, check rows, history and undo
  importlogic.js           Templates, column matching, checking rows, undo plans (pure, unit-tested)
  xlsx.js                  Reads and writes .xlsx and .csv with no extra packages (unit-tested)
  app.js                   Navigation, record screens, form designer
  admin.js                 Security groups and users screens (admins only)
  auth.js                  Sign-in screen: Google, email and password, password reset
  ui.js, util.js           Shared helpers
  styles.css               All styles (light and dark)
  examples.json            Example forms an admin can load from the designer
firebase.json, .firebaserc Firebase CLI config: Hosting only, project tasks-2ae9d
.env.example               Web app settings to copy into .env.local
tests/unit/                Formula and permission tests (node --test)
scripts/make-admin.mjs     Promote a user to administrator
.github/workflows/deploy.yml  Test on every PR; deploy Hosting on push to main

Security rules, Storage rules, indexes and their tests live in the Cadence folder.
```

### Data model (Firestore)

| Collection | Document | Written by |
|---|---|---|
| `forms/{formId}` | `name, itemName, description, color, showInSidebar, order, titleField, fields[], children[]` | admins |
| `records/{id}` | `formId, values{fieldId: value}, parentId, parentFormId, ownerId, createdBy, createdAt, updatedAt, updatedBy` | per access |
| `groups/{id}` | `name, description, access{formId or "*": {view, edit}}` | admins |
| `users/{uid}` | `email, displayName, role, groups[], access{…}, createdAt` | self on first sign-in; admins after |
| `profiles/{uid}` | `displayName` (readable by everyone signed in, for "Created by") | self |
| `listViews/{id}` | `formId, name, ownerId, shared, cols[], sort{key, dir}, filters{fieldId: [options]}, density, createdAt, updatedAt` | owner (private); admins (shared, and `dflt-<formId>`) |
| `imports/{id}` | `formId, formName, fileName, ownerId, createdAt, stamp, status, added[], updated[], counts{}, finishedAt, undoneAt, undoneBy, undo{}` | admins |
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

Every screen uses the width it has, up to 1,600 pixels (dashboards use all of it); phones are unchanged.

Sorting goes by the real value everywhere (lists, grids, report tables, drill-downs): dates and times by calendar, numbers by size, text in natural order (Item 2 before Item 10), blanks last. That includes a record's title column when the title field is a date or a number, the parent column, and "Link to record" columns.

Each form's list can be set up from the list itself.

- **Columns:** **Columns** opens a picker. Tick fields to show them and use the arrows to reorder. Besides the form's own fields, you can add the parent record (**Belongs to**), fields of the parent (Clients › Status), counts of child records (how many Site visits), and **Last updated**, **Created** and **Created by**. The record's title is always the first column.
- **Sort:** click a column heading; click again to reverse. Empty values always go last.
- **Filter:** **Filter** lists the form's choice fields (dropdown, single choice, multiple choice, yes/no). Tick options to show records with any of them; every field you filter must match.
- **Row height:** Comfortable or Compact.
- **Saved views:** tabs above the list. When you change anything, **Reset**, **Save view** and **Save as new view** appear.
  - The first tab, **All …**, is the form's default list. Until an admin saves it, it shows the fields with **Column in the starting list** turned on in the form designer. An admin's **Save view for everyone** changes it for everyone; **View options › Go back to the form's list columns** undoes that.
  - Your own views are private (**Just me**). Admins can also save a view for everyone, or share or unshare one under **View options**.
  - The app remembers the last view you used for each form on each device.
- **Select several:** tick rows (or **select all**, which picks only the rows shown). A bar appears with:
  - **Set field:** set a dropdown, single choice or yes/no field to the same value on all of them.
  - **Export CSV:** the selected records with the columns you're showing.
  - **Delete:** asks first, then gives you about 6 seconds to **Undo** before anything is deleted. Child records stay (without a parent), and linked Cadence tasks show the record as removed. Closing the app during those seconds cancels the delete.
  - Records you aren't allowed to edit are skipped, and the bar and dialog say how many.
- **Phones:** the list shows cards with tick boxes, and menus open as a sheet at the bottom.

A view only decides how the list looks. It never shows anyone records they couldn't already see.

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

---

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
| `VITE_CADENCE_URL` | Cadence's address, for example `https://you.github.io/cadence/` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Cadence's `authDomain` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Cadence's `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Cadence's `messagingSenderId` |
| `VITE_FIREBASE_APP_ID` | Cadence's `appId` |

Create a `production` environment in GitHub if you want deploy approvals. The deploy job uses it.

Manual deploy: `FIREBASE_HOSTING_SITE=cadence-forms npm run deploy` (with your site's name).

---

## Security

- **New accounts see nothing** until an admin adds them to a security group: no forms, names, shared dashboards, reports or list views. The rules enforce it; the app also waits, so a new account gets no permission errors.
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
