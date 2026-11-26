# Known limits

This page lists the cases in which a verdict of sf-tester can be wrong in this preview. It also lists the work that the tools cannot do, and the defects that this preview corrects.

## Where the list comes from

In the break run of 2026-11-14, test agents used the tools on three test orgs and tried to get wrong answers. A second set of agents did each finding again, and all 93 findings occurred again.

The 93 findings have these classes: 13 false green, 39 false red, 19 unclear error, 13 component with no tool, and 9 crash or hang.

- 55 findings are in 42 fix-list entries. They are the false greens, the false reds and one crash or hang defect of `sf_list`.
- 38 findings are in 29 limits.
- 5 fix-list entries came after the break run: 4 from a time zone test and 1 about `sf_api` queries.

The fix list thus has 47 entries. This preview corrects 44 entries. It corrects 3 entries in part: F37, F38 and F39.

How to read the classes and the ids:

- False green: the tool reports no failure, but the page or the org shows a different result. A PASS can be wrong.
- False red: the tool reports a failure, but the page or the org is correct. A FAIL can be wrong.
- `F<n>` is the number of a fix-list entry. `L<n>` is the number of a limit.

## Open: a verdict can be wrong

Each row is the open case of a fix-list entry that this preview corrects in part. The section "Fixed in this preview" gives the cases that are corrected.

### False green (1 entry)

| Id | Tool | Case | Effect |
|---|---|---|---|
| F37 | `sf_on_top`, `sf_launch_action` | A `LightningAlert` or a `LightningConfirm` covers the page. | `sf_on_top` answers `modalOpen: false`, thus a check that expects no dialog gives a PASS. `sf_launch_action` does not return a dialog of this type. Both effects come from the code: no test did them. |

### False red (2 entries)

| Id | Tool | Case | Effect |
|---|---|---|---|
| F38 | `sf_edit_record`, `sf_create_record` | The standard New or Edit dialog opens on a record page that has a custom Aura template (`lightning:recordHomeTemplate`). | The two tools do not find the dialog. This effect comes from the code review: no test did it. `sf_modal`, and `sf_click` and `sf_fill` with `inModal`, find the dialog. |
| F39 | `sf_assert_field` | You assert a Rich Text Area with its plain text, with `via: "api"` or `via: "both"`. | `FIELD_VALUE_MISMATCH`. The API value is the stored markup, for example `<p>`. |

### Unclear error, crash or hang, component with no tool

No open fix-list entry has one of these three classes. The findings of these classes are in the section "Limits".

## Limits

A limit does not give a wrong PASS or a wrong FAIL about the page. The tool cannot do the work, or its error is not clear. There is no L13: that entry is F42, which this preview corrects. L31 to L33 did not come from the break run: they came from the corrections.

### Forms and fields

- **L1** `sf_set_fields`: a dependent picklist while its controlling field is empty. The call waits 30 s and gives a raw `LOCATOR_TIMEOUT`. The answer does not say which fields were set. Set the controlling field first.
- **L2** `sf_save`: a duplicate rule alert opens when you press Save. The tool answers `CREATE_UNCONFIRMED: the New dialog closed but no new record page opened`, but the New dialog is open and no record was made. Read the alert with `sf_modal`, close it with `sf_click` and `inModal`, then call `sf_save` again.
- **L3** `sf_set_fields`: a dialog opens over the form during one call. The call waits 30 s and gives a raw `LOCATOR_TIMEOUT`, and a field can stay partly set. Close the dialog and do the call again.
- **L4** `sf_save`: there is no argument for Save & New. After a click on that button, `sf_set_fields` and `sf_save` answer `FORM_CLOSED` while the second New form shows. `sf_fill` and `sf_click` with `inModal` get to the second form, but they do not read the saved record back.
- **L5** `sf_create_record`: the user cannot see the object. The tool gives a raw `API_ERROR` with `403 INSUFFICIENT_ACCESS`. Read it as "this user cannot see the object".
- **L6** `sf_create_record`: an Aura component overrides the New action (`lightning:actionOverride`). The override opens as a page, not as a dialog, and the tool gives a raw `LOCATOR_TIMEOUT` after 30 s. Use `sf_fill` and `sf_click` on that page, then read the record with `sf_api`.
- **L7** `sf_fill` with role `combobox` on a picklist of a record form. The tool answers `UNEXPECTED: locator.fill: Error: Element is not an <input>, <textarea> or [contenteditable] element` and the dropdown stays open. Use `sf_set_fields`.
- **L8** `sf_fill`: a slider (`input type="range"`) and a value that is not in its range. The tool answers `UNEXPECTED: locator.fill: Error: Malformed value`, and the slider keeps its value. A value in the range works.
- **L9** `sf_fill`: `ui:inputRichText`. Its editor is in an iframe, and the tool answers `NOT_FOUND`. No other tool can put text into it.
- **L10** `sf_upload_file`: the scope holds two file inputs. The tool answers `NO_SINGLE_FILE_INPUT: expected one file input in the scope, found 2`, and it has no `name` or `nth` argument. There is no workaround.
- **L11** `sf_upload_file`: Upload Files on the Notes & Attachments related list. The tool gives a raw `LOCATOR_TIMEOUT` on the record page and `NO_SINGLE_FILE_INPUT ... found 0` on the View All page. No file is uploaded, and there is no workaround.
- **L12** This preview corrects L12 together with F19: `sf_set_fields` sets a Geolocation field in inline edit on a page that has a second pair of Latitude and Longitude boxes. The check is a test that uses no org.
- **L33** `sf_assert_field` with `via: "ui"` or `via: "both"`: a Number or a Percent for a user whose locale uses a comma as the decimal mark. The tool reads only the English separators, and the answer is `FIELD_VALUE_MISMATCH`. This limit comes from the code: no test did it. Use `via: "api"`.

### Lists

- **L14** `sf_click`: the row checkbox of an Aura list or grid, for example the Recycle Bin list and the Add Products picker. The call gives a raw `LOCATOR_TIMEOUT` after 10 s and the box gets no tick. In the Recycle Bin, use "Show Actions" on the row. The picker has no workaround.

### Flows

- **L15** `sf_click`: an option of a closed native select on a flow screen. The call gives a raw `LOCATOR_TIMEOUT` after 20 s. The tool for a select is `sf_fill`.
- **L16** `sf_page_snapshot`, `sf_measure`: an image that did not load. The snapshot lists the `img`, and `sf_measure` gives `visible: 1` for the box of its alternative text. No tool says that the picture is missing, thus a check "the image shows" passes.
- **L17** `sf_click`: a button below a spinner that stays. The call gives a raw `LOCATOR_TIMEOUT` after 10 s. `sf_page_snapshot` shows the cause: it marks the lines below the spinner as `covered`.

### Modals

- **L18** `sf_modal` with `action: "close"`: the dialog has no Close, Cancel or "Cancel and close" button. The call waits 30 s, does not use `timeoutMs`, and gives a raw `LOCATOR_TIMEOUT`. Use `sf_click` with `inModal: true` on the button that the dialog has.
- **L19** `sf_modal` with `action: "snapshot"`: a list view dialog that shows its frame first, for example Change Owner. The answer holds only the heading and the footer buttons, and nothing says that the dialog is not complete. Use `sf_wait` with `inModal` for a field of the dialog first.
- **L20** `sf_wait` with `inModal` while no dialog is open. The call waits 30 s, does not use `timeoutMs`, and gives a raw `LOCATOR_TIMEOUT`, not `TIMEOUT`. Call `sf_modal` with `action: "snapshot"` and a short `timeoutMs` first.

### Navigation and search

- **L21** `sf_open_tab`: a standard tab in the overflow menu of the navigation bar, for example Home. The tool answers `TAB_UNAVAILABLE` and the browser stays below a dialog "Page doesn't exist". Use `sf_click` on "Show more navigation items", then on the menu item.
- **L22** `sf_open_tab` goes to the URL of the tab. A page that set `lightning:unsavedChanges` does not show its dialog, and the unsaved state goes away with no message. Go away from the page with a click on a link or a button of the app.
- **L23** `sf_click`, `sf_launch_action`: a link, a button or an action that opens a new browser tab or window. `sf_click` answers ok, and `sf_launch_action` answers `navigated: true` with the URL of the page that did not move. No tool reads or closes the new tab.
- **L24** `sf_open_record`: a record of an object that the user cannot read. The tool waits 60 s and answers `NO_HIGHLIGHTS`, not `RECORD_UNAVAILABLE`. `sf_page_snapshot` after the error shows the text of the page.
- **L31** `sf_search`: a search that Salesforce reads as a question and that finds no row, for example "accounts created today". The page shows no result row and no "no matches" text, and the tool answers `SEARCH_FAILED` after the full timeout. One measurement, on one org.

### Aura and base components

- **L25** `sf_click`: a control that opens a popup. The click is correct and the popup opens, but the answer has no `opened` key. Read the popup with `sf_page_snapshot` or `sf_modal`, then click the item by its role.
- **L26** `sf_click`: a control that is not enabled. The call gives a raw `LOCATOR_TIMEOUT` after 10 s. The snapshot marks the control `[disabled]`: read the snapshot before the click.
- **L27** A button in the page has the name of a button in the global header, for example the "Help" button of `lightning:helptext`. The answer is `AMBIGUOUS: 2 buttons named "Help"`, and its snapshot holds only one of them. Use `nth`.
- **L28** Drag and drop. No tool takes a source and a target. The tools cannot do an HTML5 drag or change the width of a `lightning-datatable` column.
- **L32** `sf_lwc_read`, and each tool that you scope with `recordId` and `lwcApiName`: a custom Aura component. An Aura component has no host element to scope by its name. The tool answers `BAD_ARGS` with the reason `auraComponent` in a maximum of 2 s. Aim at the control with its role and its name on the page.

### App Builder pages

- **L29** `sf_page_snapshot`: a page whose content is in an iframe, for example a Visualforce tab or a web tab. `sf_page_snapshot` takes no `frame`. `sf_wait`, `sf_click`, `sf_fill` and `sf_measure` take `frame`.

### Sessions and users

- **L30** `sf_login_as`: from one Login As user to a second user, or back to the admin. The call can wait 60 s and give a raw `LOCATOR_TIMEOUT`, and then the session is not usable. Call `sf_start` with the same session id. The session is the admin again, and `sf_login_as` then works.

## Fixed in this preview

The entries are in the sequence of their numbers. Where a correction adds a wait, a new error or a limit, its entry says so.

- **F1** `sf_fill` gives `VALUE_NOT_SET` when a date, time or number component does not keep the typed value.
- **F2** `sf_fill` selects an option of a native select in a Lightning component: a Picklist or a Multi-Select Picklist on a flow screen, and an Aura `lightning:select`. `VALUE_NOT_FOUND` lists the options.
- **F3** `sf_toasts` and the `toast` condition of `sf_wait` record the toast of a `ShowToastEvent` that has `messageData`.
- **F4** `sf_toasts` and the `toast` condition of `sf_wait` record a toast that a component shows with the `lightning/toast` module (`Toast.show`).
- **F5** A toast message does not end in "undefined" when one entry of its data has no label. If that entry is in the middle of the message, the message has two spaces there.
- **F6** `sf_hover`, `sf_click`, `sf_on_top` and `sf_measure` find by `text` a label that holds a hidden child element, thus `sf_hover` can open a hover card that uses only CSS. For such a label, the call first waits until the aim timeout ends.
- **F7** A `row` text that goes across two cells of one table row finds the row. `sf_list` finds such a row for its `select` and `massEdit` actions. `AMBIGUOUS_ROW` can now occur for a text that two rows hold in this way.
- **F8** `sf_on_top` and `sf_measure` find a column header of an Aura `lightning:datatable`, and a `lightning-input` or a `lightning-textarea` that has `required`, by the name that the page shows. `AMBIGUOUS` can now occur when a shown name and a hidden name are the same.
- **F9** With `row`, the tools look for `column` in the table of that row, thus two tables can have the same column label. Without `row`, the answer continues to be `AMBIGUOUS`.
- **F10** The tools find a table cell by its role (`cell`, `gridcell` or `rowheader`) with `row` and `column`.
- **F11** `sf_wait` finds a text of two or more words that is in two block elements, also with `gone: true` and with `any`.
- **F12** On a page with Dynamic Actions, `sf_actions` lists the actions of the page, as its ribbon shows them. An action whose visibility rule uses a field that the user cannot read comes back as `shown: 'unknown'`.
- **F13** On a Dynamic Forms page that shows the user no field, `sf_form_model` and `sf_edit_record` give an empty field list with the source `dynamicForms`.
- **F14** On a Dynamic Forms record page, the model gives a standard lookup the label of the form ("Account Name"), thus `sf_set_fields` finds it.
- **F15** On a Dynamic Forms record page, the model gives each part of a custom Address the label of the form ("<field> (City)"). `sf_set_fields` sets the parts and `sf_assert_field` reads them.
- **F16** `sf_cancel` gives `FORM_CLOSED` and names the New dialog that Save & New left open.
- **F17** `sf_set_fields` refuses a Date/Time in the first pass of the hour that the time zone of the user repeats (`VALUE_NOT_SET`). It refuses a Date/Time with seconds (`INVALID_VALUE`).
- **F18** `sf_set_fields` opens the editor of a Rich Text Area with a click and then types, on the New form and on the Edit form.
- **F19** `sf_set_fields` sets the Latitude and the Longitude of a Geolocation field, and `sf_assert_field` reads each of them on the record page.
- **F20** On a Dynamic Forms record page of a Contact, `sf_edit_inline` opens the compound Name from First Name. `sf_assert_field` passes on Name and on First Name with `via: "ui"`.
- **F21** `sf_create_record` makes the model of the New dialog from the Dynamic Forms page, thus the model has the fields that the dialog shows.
- **F22** `sf_assert_field` with `via: "ui"` gives `FIELD_NOT_SHOWN` on the first load after the user collapses the section. Each assert with `via: "ui"` or `via: "both"` now waits 1 s more.
- **F23** `sf_assert_field` passes on a Text Area that holds more than one line, with LF or CRLF line ends. The page comparison reads a sequence of spaces or tabs as one space.
- **F24** `sf_assert_field` passes on a Number of 1,000 or more and on a Percent with `via: "ui"` or `via: "both"`. You can give the value as `12345` or as the page shows it. L33 gives the limit.
- **F25** `sf_assert_field` does not read the text of the help icon as a part of the value.
- **F26** `sf_assert_field` passes on Owner and on Created By with `via: "ui"` or `via: "both"`, by the name of the user or by the id. Created Date and Last Modified Date give the date.
- **F27** `sf_assert_field` finds a part of a compound Address, for example Billing City, in the address that the page shows. With `via: "ui"` it also reads the stored part, and the two must agree. Thus a value that is only the text of a different part gives `FIELD_VALUE_MISMATCH`.
- **F28** `sf_assert_field` passes on a checkbox when the expected value is the text that the page shows, "True" or "False".
- **F29** `sf_assert_field` and the read-back of `sf_save` compare a multi-select picklist as a set of values. The sequence of the values is not important.
- **F30** `sf_search` returns the results page after it becomes stable, with the result row or with the no-results page.
- **F31** A second `sf_search` from the search results page returns the new results. L31 gives the case that continues to fail.
- **F32** `sf_open_record` opens a record page that has no Highlights Panel and answers `highlights: false`. Each time it opens such a page, it waits 5 s for the panel.
- **F33** `sf_wait` does not count a text on an off-stage carousel slide as shown. `sf_on_top` did not change.
- **F34** `sf_on_top` and `sf_measure` give the correct `visible` value for a `position: fixed` dropdown in a modal that scrolls.
- **F35** `sf_launch_action` returns the Change Owner dialog and the Change Record Type dialog with their forms.
- **F36** A `recordId` with no `lwcApiName` opens that record before the tool acts. A value that is not a record id gives `BAD_ARGS`. A `recordId` with `inModal` continues to act in the modal.
- **F37** `sf_modal`, and the tools that take `inModal`, read a `LightningAlert` or a `LightningConfirm`, and a click in it closes it. The section "Open" gives the case that is not corrected.
- **F38** `sf_modal`, and `sf_click` and `sf_fill` with `inModal`, find the standard New or Edit dialog on a record page that has a custom Aura template. When the page hides a dialog from assistive technology, `sf_modal` answers `hiddenBy` and the text of the dialog. `sf_launch_action` and the `mass` action of `sf_list` do the same. The section "Open" gives the case that is not corrected.
- **F39** `sf_save` confirms a create, and `sf_assert_field` passes with `via: "api"` or `via: "both"`, for a text value that holds `&`, `<`, `>`, `'` or `"`. The section "Open" gives the case that is not corrected.
- **F40** For a custom Aura component, `sf_lwc_read` and the tools that you scope with `recordId` and `lwcApiName` answer `BAD_ARGS`, not `NOT_ON_PAGE` after 31 s. L32 gives the limit.
- **F41** After a Visualforce page, `sf_whoami` reads the app from the navigation bar, and `appReason` says so.
- **F42** `sf_list` runs in a session that `sf_start` made with `session: "new"`.
- **F43** `sf_set_fields` refuses `StartDateTime` or `EndDateTime` together with `IsAllDayEvent: true` (`INVALID_VALUE`). Thus `sf_set_fields` cannot set the date of an all-day Event: use `sf_fill` with the date text.
- **F44** `sf_assert_field` with `via: "both"` passes on the Start or the End of an all-day Event that holds the expected value.
- **F45** `sf_set_fields`, `sf_save` and `sf_assert_field` refuse a date or an instant that is not on the calendar, for example 30 February or `T24:00:00` (`INVALID_VALUE`).
- **F46** `sf_assert_field` with `via: "ui"` passes on a Date, a Date/Time or a Time when the expected value is the ISO value.
- **F47** `sf_api` encodes a SOQL or SOSL query, thus `%`, `+` and `&` in a literal work. A `+` in a query is now a literal plus: `SELECT+Id+FROM` gives `MALFORMED_QUERY`.
