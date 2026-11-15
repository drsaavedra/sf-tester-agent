# Flow: what sf-tester can test

- Break run sha: 87463b99d83930d28df8dfecc4809be3e3a27c6e
- Break run date: 2026-11-14
- Break run users: admin (all rows); Probe Breaker (115 of the 506 deployed rows); Probe Platform (50 of the 200 in fixture rows)

35 driven, 11 seen, of 66 components.

Generated from `test/fixture-components/manifest.md`. A box is ticked only when a break run has driven the component with sf-tester's tools; `seen` means it was only seen on the page.

## flow screen components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Flow: Action Button](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_action_button.htm&type=5) | [x] | deployed |  |
| [Flow: Address](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_address.htm&type=5) | [x] | deployed |  |
| [Flow: Checkbox](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_checkbox.htm&type=5) | [x] | deployed |  |
| [Flow: Checkbox Group](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_checkboxgroup.htm&type=5) | [x] | deployed |  |
| [Flow: Choice Lookup](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_choice_lookup.htm&type=5) | [x] | deployed |  |
| [Flow: Currency](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_currency.htm&type=5) | [x] | deployed |  |
| [Flow: Data Table](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_data_table.htm&type=5) | [x] | deployed |  |
| [Flow: Date](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_date.htm&type=5) | [ ] | deployed |  |
| [Flow: Date/Time](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_datetime.htm&type=5) | [ ] | deployed |  |
| [Flow: Dependent Picklists](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_dependentpicklists.htm&type=5) | [ ] | deployed |  |
| [Flow: Display Image](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_display_image.htm&type=5) | [ ] | deployed |  |
| [Flow: Display Text](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_display_text.htm&type=5) | [x] | in fixture |  |
| [Flow: Email](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_email.htm&type=5) | [ ] | deployed |  |
| [Flow: Enhanced Message](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_enhancedmessage.htm&type=5) | [ ] | limitation | needs a Messaging session and a messaging component, which the orgs do not have |
| [Flow: File Preview](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_file_preview.htm&type=5) | [ ] | deployed |  |
| [Flow: File Upload](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_fileupload.htm&type=5) | [ ] | deployed |  |
| [Flow: File Upload (enhanced)](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_fileuploadenhanced.htm&type=5) | [ ] | deployed |  |
| [Flow: Lookup](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_lookup.htm&type=5) | [x] | deployed |  |
| [Flow: Message](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_message.htm&type=5) | [x] | deployed |  |
| [Flow: Multi-Select Picklist](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_msp.htm&type=5) | [ ] | deployed |  |
| [Flow: Name](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_name.htm&type=5) | [x] | deployed |  |
| [Flow: Number](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_number.htm&type=5) | [x] | in fixture |  |
| [Flow: Order Management Product Selector](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_ordermanagementproductselector.htm&type=5) | [ ] | limitation | unsure: Order Management product selector likely needs Salesforce Order Management; We can't find an extension called "flowruntime:orderManagementProductSelector" (Order Management is not in the org) |
| [Flow: Password](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_password.htm&type=5) | [ ] | deployed |  |
| [Flow: Phone](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_phone.htm&type=5) | [x] | deployed |  |
| [Flow: Picklist](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_picklist.htm&type=5) | [ ] | deployed |  |
| [Flow: Radio Buttons](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_radio.htm&type=5) | [x] | in fixture |  |
| [Flow: Radio Button Group](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_radio_button_group.htm&type=5) | [x] | deployed |  |
| [Flow: Repeater](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_repeater.htm&type=5) | [x] | deployed |  |
| [Flow: Section](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_section.htm&type=5) | [x] | deployed |  |
| [Flow: Slack Channel Selector](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_slackchannelselector.htm&type=5) | [ ] | limitation | unsure: Slack components likely need Slack integration; We can't find an extension called "slack:channelSelector" (no Slack components in the org) |
| [Flow: Slack Workspace Selector](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_slackworkspaceselector.htm&type=5) | [ ] | limitation | unsure: Slack components likely need Slack integration; We can't find an extension called "slack:workspaceSelector" (no Slack components in the org) |
| [Flow: Slider](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_slider.htm&type=5) | [x] | deployed |  |
| [Flow: Text](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_text.htm&type=5) | [x] | in fixture |  |
| [Flow: Long Text Area](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_textarea.htm&type=5) | [ ] | deployed |  |
| [Flow: Time](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_time.htm&type=5) | [ ] | deployed |  |
| [Flow: Toggle](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_toggle.htm&type=5) | [x] | deployed |  |
| [Flow: URL](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_url.htm&type=5) | [x] | deployed |  |
| [Flow: Visual Picker](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_screencmp_visual_picker.htm&type=5) | [x] | deployed |  |
| [Flow: Kanban Board (Beta)](https://help.salesforce.com/s/articleView?id=platform.automate_flow_ref_elements_screencmp_kanban_board.htm&type=5) | [ ] | deployed |  |

## flow navigation

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Flow footer: Next, Previous, Finish](https://help.salesforce.com/s/articleView?id=platform.automate_flow_build_screen_flows_configuring_screens.htm&type=5) | [x] | in fixture |  |
| [Screen flow in a quick action modal](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_internal_action.htm&type=5) | [x] | in fixture |  |
| [Screen flow on a Lightning page (Flow component)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [x] | in fixture |  |
| [Screen flow in the utility bar](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_internal_utilitybar.htm&type=5) | [x] | deployed |  |
| [Screen flow finish behavior (restart or retURL)](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_finish.htm&type=5) | [x] | in fixture |  |

## from the audit

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Flow footer: Pause (needs the org setting "Let users pause flows")](https://help.salesforce.com/s/articleView?id=platform.automate_flow_build_screen_flows_configuring_screens.htm&type=5) | [x] | deployed |  |

## flow: record-triggered flow error

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Custom Error from a record-triggered flow: error in a window on the record page](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_custom_error.htm&type=5) | [x] | deployed |  |
| [Custom Error from a record-triggered flow: inline error on a field](https://help.salesforce.com/s/articleView?id=platform.flow_ref_elements_custom_error.htm&type=5) | [x] | deployed |  |

## flow: launch point

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Screen flow from a custom button, custom link or direct URL (the /flow/ runtime page)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [x] | deployed |  |
| [Screen flow from a custom list button (runs on the selected list rows)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [x] | deployed |  |
| [Screen flow in a web tab](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [x] | deployed |  |
| [Screen flow in a Visualforce page (Classic runtime)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [x] | deployed |  |

## flow: screen component

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Call Script | [x] | deployed |  |
| Advanced CSV Import | [ ] | limitation | needs an industries data import product; unverified: read from the name |
| Appointment Scheduling | [ ] | limitation | needs Salesforce Scheduler; unverified: read from the name |
| Healthcare Census Members Mgmt Wrapper | [ ] | limitation | needs Health Cloud; unverified: read from the name |
| LWC Service Resource Availability | [ ] | limitation | needs Salesforce Scheduler; unverified: read from the name |
| Ramp Schedule Trial Configuration | [ ] | limitation | needs Revenue Cloud; unverified: read from the name |
| runtime_industries_csv_dataimport:impBeg | [ ] | limitation | needs an industries data import product; unverified: read from the name |
| Select Service Appointment Type | [ ] | limitation | needs Salesforce Scheduler; unverified: read from the name |
| Slack Channel Selector (Deprecated) | [ ] | limitation | needs Slack; deprecated; unverified: read from the name |

## flow: outside Lightning Experience

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Screen flow on an Experience Builder site (authenticated)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Screen flow on an Experience Builder site (unauthenticated)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Screen flow in an external Aura component or Visualforce page (Lightning Out)](https://help.salesforce.com/s/articleView?id=platform.flow_distribute_screen_flow_options.htm&type=5) | [ ] | limitation | outside Lightning Experience |
| [Screen flow run from Slack](https://help.salesforce.com/s/articleView?id=platform.flow_build_run_screen_flow_from_slack.htm&type=5) | [ ] | limitation | outside Lightning Experience, needs Slack; page title read from the Help table of contents, body not read |
| Screen flow in the Salesforce mobile app or Field Service mobile | [ ] | limitation | desktop scope; unverified: the distribution page does not name mobile |
