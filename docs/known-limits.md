# Known limits

This page lists the cases in which a verdict of sf-tester can be wrong in this preview. It also lists the work that the tools cannot do, and the defects that this preview corrects.

## Where the list comes from

In the break run of 2026-11-14, test agents used the tools on three test orgs and tried to get wrong answers. A second set of agents did each finding again, and all 93 findings occurred again.

The 93 findings have these classes: 13 false green, 39 false red, 19 unclear error, 13 component with no tool, and 9 crash or hang.

- 55 findings are in 42 fix-list entries. They are the false greens, the false reds and one crash or hang defect of `sf_list`.
- 38 findings are in 29 limits.
- 5 fix-list entries came after the break run: 4 from a time zone test and 1 about `sf_api` queries.

The fix list thus has 47 entries. This preview corrects 16 entries. 31 entries are open.

How to read the classes and the ids:

- False green: the tool reports no failure, but the page or the org shows a different result. A PASS can be wrong.
- False red: the tool reports a failure, but the page or the org is correct. A FAIL can be wrong.
- `F<n>` is the number of a fix-list entry. `L<n>` is the number of a limit.

## Open: a verdict can be wrong

Each row is one open fix-list entry. An entry that has two classes is in the table of its worst class.

### False green (4 entries)

The fix list gives these four entries the class false red. Each entry also names a false green, thus they are in this table.

| Id | Tool | Case | Effect |
|---|---|---|---|
| F4 | `sf_toasts`, and the `toast` condition and `toasts` list of `sf_wait` | A component shows a toast with the `lightning/toast` module (`Toast.show`). | The toast list is empty and the `toast` condition does not match. A check for no error toast can give a PASS. The run did not do that check: the entry names it by inference. A check that a toast showed gives a FAIL. |
| F11 | `sf_wait` | A label and its value are in two block elements, and the snapshot prints them as one `text:` line. Examples are `lightning:recordForm` in view mode, `lightning:outputField` and `lightning:fileCard`. | A wait with `gone: true` passes while the page shows the text. A wait for the text ends in `TIMEOUT`. |
| F37 | `sf_modal`, and `inModal` on `sf_click`, `sf_fill`, `sf_wait`, `sf_hover`, `sf_on_top` and `sf_measure` | A `LightningAlert` or a `LightningConfirm` covers the page. | `sf_modal` answers `{"open":false}`. A check that expects no dialog gives a PASS. A call with `inModal` ends in `LOCATOR_TIMEOUT` after 30 s. |
| F38 | `sf_modal`, `sf_click` with `inModal`, `sf_page_snapshot` | The standard New or Edit dialog opens on a record page that has a custom Aura template (`lightning:recordHomeTemplate`). | `sf_modal` answers `{"open":false}` while the dialog shows. A check that expects no dialog gives a PASS. A click with `inModal` ends in `LOCATOR_TIMEOUT` after 30 s. `sf_page_snapshot` returns only `- status`. |

### False red (27 entries)

| Id | Tool | Case | Effect |
|---|---|---|---|
| F2 | `sf_fill` | A Picklist or a Multi-Select Picklist on a flow screen, or an Aura `lightning:select`, is a native select in a Lightning component. | `VALUE_NOT_FOUND` with `"options":[]`, but the page has the option. |
| F3 | `sf_toasts`, and the `toast` condition of `sf_wait` | An LWC sends a `ShowToastEvent` that has `messageData`, for example a message template with a link. | The toast list is empty and the `toast` condition does not match. A check that a toast showed gives a FAIL. |
| F5 | `sf_toasts`, and the `toasts` list of `sf_wait`, `sf_save` and `sf_launch_action` | A toast has a message template, and one entry of its data has no label. An example is the toast of the favorites star. | The message ends in "undefined", which the page does not show. A check of the full message gives a FAIL. |
| F6 | `sf_hover`. `sf_click`, `sf_on_top` and `sf_measure` use the same text aim. | A label holds a hidden child element, for example a hover card that uses only CSS. | `NOT_FOUND: 0 elements with text "<label>"`, but the snapshot shows the text. No tool can open the hover card. |
| F7 | `sf_click`, `sf_hover`. `sf_fill`, `sf_measure` and `sf_on_top` aim with `row` in the same way. | The `row` text goes across two cells of one table row. | `ROW_NOT_FOUND`, but the row is on the page. |
| F8 | `sf_on_top`, `sf_measure` | You aim at a cell of an Aura `lightning:datatable` with `column`. Or you aim by name at a `lightning-input` or a `lightning-textarea` that has `required`. | `NOT_FOUND` after 10 s, but the page shows the column header or the input. |
| F9 | `sf_hover`, `sf_click`, `sf_fill` | Two tables on one page have the same column label, and the `row` text names one table. | `AMBIGUOUS: 2 columnheaders named "<label>"`. Workaround: aim without `column`. |
| F10 | `sf_measure`, `sf_hover`. `sf_click`, `sf_on_top` and `sf_fill` aim with `column` in the same way. | You aim at a table cell by its role (`cell`, `gridcell` or `rowheader`) with `row` and `column`. | `NOT_FOUND`, but the snapshot in the error shows the cell. The same aim with `text`, or without `column`, finds the cell. |
| F14 | `sf_set_fields`, and the `missing` list of `sf_edit_record` | A standard lookup is on a Dynamic Forms record page. The model has the label "Account ID" and the form has the label "Account Name". | `FIELD_NOT_SHOWN`, but the form shows the lookup. |
| F15 | `sf_set_fields`, `sf_assert_field`, and the `missing` list of `sf_edit_record` | A custom Address field is on a Dynamic Forms record page. The model has the label "City" and the form has the label "<field> (City)". | `FIELD_NOT_SHOWN` for each part of the address, but the form and the record page show the part. |
| F18 | `sf_set_fields`, and the `missing` list of `sf_create_record` and `sf_edit_record` | A Rich Text Area is on the New form or the Edit form of a page layout. | `FIELD_NOT_SHOWN`, but the form has the editor. The editor box is not in the page until a click starts it. |
| F19 | `sf_set_fields`, `sf_assert_field`, and the `missing` list of `sf_create_record` and `sf_edit_inline` | A Geolocation field is on a form or on a record page. | `FIELD_NOT_SHOWN` for the Latitude and the Longitude, but the form and the record page show them. |
| F20 | `sf_edit_inline`, `sf_assert_field` | The compound Name of a Contact is on a Dynamic Forms record page. | `sf_edit_inline` gives `ACTION_NOT_AVAILABLE: no "Edit Full Name" pencil`. `sf_assert_field` gives `FIELD_VALUE_MISMATCH` for Name and `FIELD_NOT_SHOWN` for First Name. |
| F21 | `sf_create_record`, `sf_set_fields` | You open the New dialog of an object whose record page uses Dynamic Forms. | `FIELD_NOT_ON_FORM` for a field that the dialog shows. The model can also list a field as editable that the dialog does not show. |
| F23 | `sf_assert_field` | A Text Area or a Text Area (Long) holds more than one line. | `FIELD_VALUE_MISMATCH`. The API value has CRLF line ends, and the page read drops a blank line. |
| F24 | `sf_assert_field` | A Number field holds 1,000 or more, or the field is a Percent. You assert with `via: "ui"` or `via: "both"`. | `FIELD_VALUE_MISMATCH`. The page shows "12,345" or "25%", and the API gives no display value. The same assert with `via: "api"` passes. |
| F25 | `sf_assert_field` | A field has help text. You assert with `via: "ui"` or `via: "both"`. | `FIELD_VALUE_MISMATCH`. The tool reads the text of the help icon, "Help <label>", as a part of the value. |
| F26 | `sf_assert_field` | You assert Owner or Created By with `via: "ui"` or `via: "both"`. | `FIELD_VALUE_MISMATCH`. The page value holds the text "Change Owner", or the label and the date of Created By. |
| F27 | `sf_assert_field` | You assert a part of a standard compound Address, for example Billing City, with `via: "ui"` or `via: "both"`. | `FIELD_NOT_SHOWN` after 17 s, but the record page shows the address. |
| F28 | `sf_assert_field` | You assert a checkbox with the text that the page shows, "True" or "False". | `FIELD_VALUE_MISMATCH`, and the error shows two equal strings. The boolean value passes. |
| F29 | `sf_assert_field` | You assert a multi-select picklist with the values in a different sequence from that of the picklist. | `FIELD_VALUE_MISMATCH`, but the record holds the same set of values. |
| F31 | `sf_search` | You call `sf_search` a second time from the search results page. | `ACTION_NOT_AVAILABLE: the header search box did not open` after 31 s. |
| F32 | `sf_open_record`. `sf_launch_action`, `sf_click` and `sf_lwc_read` open a record through it when they get a `recordId`. | The record page has no Highlights Panel. | `NO_HIGHLIGHTS` after 60 s, but the record page is open. |
| F34 | `sf_on_top`, `sf_measure` | A `position: fixed` dropdown is in a modal that scrolls. An example is the calendar of a date picker in a New or Edit dialog. | `visible: 0` with a `clippedBy` value, but the page shows the full dropdown. An `expect` on `visible` gives `MEASURE_MISMATCH`. |
| F39 | `sf_save`, `sf_assert_field` | A text value holds `&`, `<`, `>`, `'` or `"`. A Rich Text Area that you assert with `via: "api"` or `via: "both"` is the same case. | After a create, `sf_save` gives `CREATE_UNCONFIRMED`, but the record holds the typed value. `sf_assert_field` with `via: "api"` or `via: "both"` gives `FIELD_VALUE_MISMATCH`. |
| F40 | `sf_lwc_read`, and each tool that you scope with `recordId` and `lwcApiName` | A custom Aura component is on a record page. | `NOT_ON_PAGE: <component> is on <page> but did not render` after 31 s, but the page shows the component. |
| F41 | `sf_whoami` | `sf_launch_action` went through a Visualforce page and then came back to a record page. | `"app": null` with `"appReason": "the page shows no Lightning app"`, but the navigation bar shows the app. |

### Unclear error, crash or hang, component with no tool

No open fix-list entry has one of these three classes. The findings of these classes are in the section "Limits".

## Limits

A limit does not give a wrong PASS or a wrong FAIL about the page. The tool cannot do the work, or its error is not clear. There is no L13: that entry is F42, which this preview corrects.

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
- **L12** `sf_set_fields`: a Geolocation field in inline edit on a page that has a second pair of Latitude and Longitude boxes. The tool answers `UNEXPECTED: locator.selectText: Error: strict mode violation` and sets no field. `sf_save` then answers saved, but the record did not change. The correction of F19 will also correct this.

### Lists

- **L14** `sf_click`: the row checkbox of an Aura list or grid, for example the Recycle Bin list and the Add Products picker. The call gives a raw `LOCATOR_TIMEOUT` after 10 s and the box gets no tick. In the Recycle Bin, use "Show Actions" on the row. The picker has no workaround.

### Flows

- **L15** `sf_click`: an option of a closed native select on a flow screen. The call gives a raw `LOCATOR_TIMEOUT` after 20 s. The tool for a select is `sf_fill`, which does not work on a flow screen picklist in this preview (F2).
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

### Aura and base components

- **L25** `sf_click`: a control that opens a popup. The click is correct and the popup opens, but the answer has no `opened` key. Read the popup with `sf_page_snapshot` or `sf_modal`, then click the item by its role.
- **L26** `sf_click`: a control that is not enabled. The call gives a raw `LOCATOR_TIMEOUT` after 10 s. The snapshot marks the control `[disabled]`: read the snapshot before the click.
- **L27** A button in the page has the name of a button in the global header, for example the "Help" button of `lightning:helptext`. The answer is `AMBIGUOUS: 2 buttons named "Help"`, and its snapshot holds only one of them. Use `nth`.
- **L28** Drag and drop. No tool takes a source and a target. The tools cannot do an HTML5 drag or change the width of a `lightning-datatable` column.

### App Builder pages

- **L29** `sf_page_snapshot`: a page whose content is in an iframe, for example a Visualforce tab or a web tab. `sf_page_snapshot` takes no `frame`. `sf_wait`, `sf_click`, `sf_fill` and `sf_measure` take `frame`.

### Sessions and users

- **L30** `sf_login_as`: from one Login As user to a second user, or back to the admin. The call can wait 60 s and give a raw `LOCATOR_TIMEOUT`, and then the session is not usable. Call `sf_start` with the same session id. The session is the admin again, and `sf_login_as` then works.

## Fixed in this preview

- **F1** `sf_fill` gives `VALUE_NOT_SET` when a date, time or number component does not keep the typed value.
- **F12** On a page with Dynamic Actions, `sf_actions` lists the actions of the page, as its ribbon shows them. An action whose visibility rule uses a field that the user cannot read comes back as `shown: 'unknown'`.
- **F13** On a Dynamic Forms page that shows the user no field, `sf_form_model` and `sf_edit_record` give an empty field list with the source `dynamicForms`. The New dialog of such a page is open as F21.
- **F16** `sf_cancel` gives `FORM_CLOSED` and names the New dialog that Save & New left open.
- **F17** `sf_set_fields` refuses a Date/Time in the first pass of the hour that the time zone of the user repeats (`VALUE_NOT_SET`). It refuses a Date/Time with seconds (`INVALID_VALUE`).
- **F22** `sf_assert_field` with `via: "ui"` gives `FIELD_NOT_SHOWN` on the first load after the user collapses the section. Each assert with `via: "ui"` or `via: "both"` now waits 1 s more.
- **F30** `sf_search` returns the results page after it becomes stable, with the result row or with the no-results page.
- **F33** `sf_wait` does not count a text on an off-stage carousel slide as shown. `sf_on_top` did not change.
- **F35** `sf_launch_action` returns the Change Owner dialog and the Change Record Type dialog with their forms.
- **F36** A `recordId` with no `lwcApiName` opens that record before the tool acts. A value that is not a record id gives `BAD_ARGS`. A `recordId` with `inModal` continues to act in the modal.
- **F42** `sf_list` runs in a session that `sf_start` made with `session: "new"`.
- **F43** `sf_set_fields` refuses `StartDateTime` or `EndDateTime` together with `IsAllDayEvent: true` (`INVALID_VALUE`). Thus `sf_set_fields` cannot set the date of an all-day Event: use `sf_fill` with the date text.
- **F44** `sf_assert_field` with `via: "both"` passes on the Start or the End of an all-day Event that holds the expected value.
- **F45** `sf_set_fields`, `sf_save` and `sf_assert_field` refuse a date or an instant that is not on the calendar, for example 30 February or `T24:00:00` (`INVALID_VALUE`).
- **F46** `sf_assert_field` with `via: "ui"` passes on a Date, a Date/Time or a Time when the expected value is the ISO value.
- **F47** `sf_api` encodes a SOQL or SOSL query, thus `%`, `+` and `&` in a literal work. A `+` in a query is now a literal plus: `SELECT+Id+FROM` gives `MALFORMED_QUERY`.
