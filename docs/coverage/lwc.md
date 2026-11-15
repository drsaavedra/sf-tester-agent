# LWC: what sf-tester can test

- Break run sha: 87463b99d83930d28df8dfecc4809be3e3a27c6e
- Break run date: 2026-11-14
- Break run users: admin (all rows); Probe Breaker (115 of the 506 deployed rows); Probe Platform (50 of the 200 in fixture rows)

93 driven, 8 seen, of 176 components.

Generated from `test/fixture-components/manifest.md`. A box is ticked only when a break run has driven the component with sf-tester's tools; `seen` means it was only seen on the page.

## base: actions and menus

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button) | [ ] | in fixture |  |
| [lightning-button-group](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button-group) | [x] | deployed |  |
| [lightning-button-icon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button-icon) | [ ] | in fixture |  |
| [lightning-button-icon-stateful](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button-icon-stateful) | [x] | in fixture |  |
| [lightning-button-menu](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button-menu) | [x] | in fixture |  |
| [lightning-button-stateful](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-button-stateful) | [x] | in fixture |  |
| [lightning-click-to-dial](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-click-to-dial) | [x] | deployed |  |
| [lightning-flow](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-flow) | [ ] | in fixture |  |

## base: containers

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-accordion](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-accordion) | [x] | in fixture |  |
| [lightning-card](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-card) | [ ] | in fixture |  |
| [lightning-carousel](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-carousel) | [x] | deployed |  |
| [lightning-quick-action-panel](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-quick-action-panel) | [ ] | in fixture |  |
| [lightning-layout](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-layout) | [ ] | deployed |  |
| [lightning-tabset](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tabset) | [x] | in fixture |  |
| [lightning-tile](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tile) | [x] | deployed |  |

## base: visuals

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-avatar](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-avatar) | [x] | deployed |  |
| [lightning-badge](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-badge) | [x] | deployed |  |
| [lightning-dynamic-icon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-dynamic-icon) | [x] | deployed |  |
| [lightning-helptext](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-helptext) | [ ] | in fixture |  |
| [lightning-icon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-icon) | [ ] | in fixture |  |
| [lightning-map](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-map) | [x] | deployed |  |
| [lightning-pill](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-pill) | [x] | deployed |  |
| [lightning-pill-container](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-pill-container) | [x] | in fixture |  |

## base: input

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-checkbox-group](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-checkbox-group) | [x] | in fixture |  |
| [lightning-combobox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-combobox) | [x] | in fixture |  |
| [lightning-dual-listbox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-dual-listbox) | [x] | in fixture |  |
| [lightning-file-upload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-file-upload) | [ ] | in fixture |  |
| [lightning-input type=text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=checkbox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=checkbox-button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=toggle](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=date](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=datetime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=time](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [ ] | in fixture |  |
| [lightning-input type=email](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=file](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | deployed |  |
| [lightning-input type=password](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=search](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=tel](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=url](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input type=number](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input) | [x] | in fixture |  |
| [lightning-input-address](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input-address) | [x] | in fixture |  |
| [lightning-input-location](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input-location) | [x] | in fixture |  |
| [lightning-input-name](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input-name) | [x] | in fixture |  |
| [lightning-input-rich-text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-input-rich-text) | [x] | in fixture |  |
| [lightning-radio-group](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-radio-group) | [x] | in fixture |  |
| [lightning-record-picker](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-picker) | [ ] | in fixture |  |
| [lightning-select](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-select) | [x] | deployed |  |
| [lightning-slider](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-slider) | [x] | in fixture |  |
| [lightning-textarea](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-textarea) | [x] | in fixture |  |

## base: forms

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-record-edit-form with lightning-input-field](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-edit-form) | [ ] | in fixture |  |
| [lightning-record-view-form with lightning-output-field](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-view-form) | [x] | deployed |  |
| [lightning-record-form](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-record-form) | [x] | deployed |  |

## base: navigation

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-breadcrumbs](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-breadcrumbs) | [x] | in fixture |  |
| [lightning-vertical-navigation](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-vertical-navigation) | [x] | in fixture |  |

## base: output

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-formatted-address](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-address) | [x] | deployed |  |
| [lightning-formatted-date-time](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-date-time) | [x] | deployed |  |
| [lightning-formatted-email](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-email) | [x] | deployed |  |
| [lightning-formatted-location](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-location) | [x] | deployed |  |
| [lightning-formatted-name](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-name) | [x] | deployed |  |
| [lightning-formatted-number](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-number) | [x] | deployed |  |
| [lightning-formatted-phone](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-phone) | [x] | deployed |  |
| [lightning-formatted-rich-text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-rich-text) | [x] | deployed |  |
| [lightning-formatted-text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-text) | [x] | deployed |  |
| [lightning-formatted-time](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-time) | [x] | deployed |  |
| [lightning-formatted-url](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-formatted-url) | [x] | deployed |  |
| [lightning-relative-date-time](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-relative-date-time) | [x] | deployed |  |

## base: progress

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-progress-bar](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-progress-bar) | [x] | deployed |  |
| [lightning-progress-indicator](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-progress-indicator) | [x] | deployed |  |
| [lightning-progress-ring](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-progress-ring) | [x] | deployed |  |
| [lightning-spinner](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-spinner) | [x] | in fixture |  |

## base: tables and trees

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-datatable: row selection, sort, row action menu, button column, inline edit (five interactions in five fixture tables)](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [x] | in fixture |  |
| [lightning-tree](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tree) | [x] | in fixture |  |
| [lightning-tree-grid](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tree-grid) | [ ] | in fixture |  |

## modules

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning/modal LightningModal](https://developer.salesforce.com/docs/platform/lwc/guide/use-dialog-modal.md) | [ ] | in fixture |  |
| [lightning/alert](https://developer.salesforce.com/docs/platform/lwc/guide/use-dialog-alert.md) | [ ] | deployed |  |
| [lightning/confirm](https://developer.salesforce.com/docs/platform/lwc/guide/use-dialog-confirm.md) | [ ] | deployed |  |
| [lightning/prompt](https://developer.salesforce.com/docs/platform/lwc/guide/use-dialog-prompt.md) | [x] | deployed |  |
| [lightning/platformShowToastEvent](https://developer.salesforce.com/docs/platform/lwc/guide/use-toast.md) | [ ] | in fixture |  |
| [lightning/toast with lightning/toastContainer](https://developer.salesforce.com/docs/platform/lwc/guide/use-toast.md) | [ ] | deployed |  |
| [lightning/navigation (targets that open standard UI)](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-navigation) | [x] | deployed |  |
| [lightning/flowSupport (custom flow screen component navigation)](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-flow-support) | [ ] | deployed |  |

## lwc: API or data module

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning/accApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-acc-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/analyticsWaveApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-analytics-wave-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/cmsDeliveryApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-cms-delivery-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/commerceCartApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-commerce-cart-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/commerceRegisterGuestBuyerApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-commerce-register-guest-buyer-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/commerceRepricingApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-commerce-repricing-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/conversationToolkitApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-conversation-toolkit-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/empApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-emp-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning-events](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-events) | [ ] | not UI | events page, no component |
| [lightning/industriesEducationPublicApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-industries-education-public-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning-interfaces](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-interfaces) | [ ] | not UI | interfaces page, no component |
| [lightning/logger](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-logger) | [ ] | not UI | API or data module, renders nothing |
| [lightning/mediaUtils](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-media-utils) | [ ] | not UI | API or data module, renders nothing |
| [lightning/messageService](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-message-service) | [ ] | not UI | API or data module, renders nothing |
| [lightning/omnistudioPubsub](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-omnistudio-pubsub) | [ ] | not UI | API or data module, renders nothing |
| [lightning/pageReferenceUtils](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-page-reference-utils) | [ ] | not UI | API or data module, renders nothing |
| [lightning/platformNavigationItemApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-platform-navigation-item-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/platformResourceLoader](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-platform-resource-loader) | [ ] | not UI | API or data module, renders nothing |
| [lightning/platformUtilityBarApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-platform-utility-bar-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/platformWorkspaceApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-platform-workspace-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning-service-cloud-voice-toolkit-api](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-service-cloud-voice-toolkit-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/serviceKnowledgeApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-service-knowledge-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiAppsApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-apps-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiLayoutApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-layout-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiLearningPlatformApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-learning-platform-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiListApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-list-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiListsApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-lists-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiObjectInfoApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-object-info-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiRecordApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-record-api) | [ ] | not UI | API or data module, renders nothing |
| [lightning/uiRelatedListApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-related-list-api) | [ ] | not UI | API or data module, renders nothing |

## lwc: child component

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-accordion-section](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-accordion-section) | [x] | in fixture |  |
| [lightning-breadcrumb](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-breadcrumb) | [x] | in fixture |  |
| [lightning-carousel-image](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-carousel-image) | [x] | deployed |  |
| [lightning-layout-item](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-layout-item) | [x] | deployed |  |
| [lightning-menu-item](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-menu-item) | [x] | in fixture |  |
| [lightning-modal-body](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-modal-body) | [ ] | in fixture |  |
| [lightning-modal-footer](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-modal-footer) | [ ] | in fixture |  |
| [lightning-modal-header](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-modal-header) | [ ] | in fixture |  |
| [lightning-progress-step](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-progress-step) | [x] | deployed |  |
| [lightning-tab](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-tab) | [x] | in fixture |  |
| [lightning-vertical-navigation-item](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-vertical-navigation-item) | [x] | in fixture |  |

## lwc: base component

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-barcode-scanner](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-barcode-scanner) | [ ] | limitation | reference page: Salesforce Mobile App only; the fixture is Lightning Experience desktop |
| [lightning-dynamic-list-container](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-dynamic-list-container) | [ ] | limitation | needs the Dynamic List setup (Developer Preview); on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): it renders empty; earlier: Developer Preview; validates on the org; the org has none of its setup, so expect an empty or error render |
| [lightning-dynamic-list-item](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-dynamic-list-item) | [ ] | limitation | needs the Dynamic List setup (Developer Preview); on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): it renders empty; earlier: Developer Preview; validates on the org; the org has none of its setup, so expect an empty or error render |
| [lightning-empty-state](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-empty-state) | [x] | deployed |  |
| [lightning-illustration](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-illustration) | [x] | deployed |  |
| [lightning-menu-divider](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-menu-divider) | [x] | deployed |  |
| [lightning-menu-subheader](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-menu-subheader) | [x] | deployed |  |
| [lightning-omnistudio-flexcard](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-omnistudio-flexcard) | [ ] | limitation | needs an OmniStudio licence and a FlexCard; on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): an inline NoAccessException text; earlier: Omnistudio licence; no Flexcard SfUiCCard exists; validates on the org; the org has none of its setup, so expect an empty or error render |
| [lightning-omnistudio-omniscript](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-omnistudio-omniscript) | [ ] | limitation | needs an OmniStudio licence and an OmniScript; on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): it renders empty; earlier: Omnistudio licence; no Omniscript exists; validates on the org; the org has none of its setup, so expect an empty or error render |
| [lightning-rich-text-toolbar-button-group](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-rich-text-toolbar-button-group) | [x] | deployed |  |
| [lightning-rich-text-toolbar-button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-rich-text-toolbar-button) | [x] | deployed |  |
| [lightning-ui-embedding](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-ui-embedding) | [ ] | limitation | needs a UI embedding setup; on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): it renders empty; earlier: the reference page names no attributes; validates on the org; the org has none of its setup, so expect an empty or error render |
| [lightning-vertical-navigation-item-badge](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-vertical-navigation-item-badge) | [x] | deployed |  |
| [lightning-vertical-navigation-item-icon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-vertical-navigation-item-icon) | [x] | deployed |  |

## lwc: lightning-input type page

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-input type=color](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-color) | [x] | deployed |  |
| [lightning-input type=range](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-range) | [x] | deployed |  |

## lwc: module that opens UI

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning/distributedMarketing](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-distributed-marketing) | [ ] | limitation | needs Distributed Marketing setup; on the page (render check on sfui-s4-fixtures, 2026-11-13 (SFUIC Gated, both users)): an error text after the button click; earlier: button SFUIC Open Distributed Marketing; validates on the org; the org has none of its setup, so expect an empty or error render, shown in the result line |
| [lightning/fileDownload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-file-download) | [ ] | limitation | reference page: for Experience Builder sites (LWR) only; Experience Cloud, out of scope for this fixture |
| [lightning/refresh](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-refresh) | [x] | deployed |  |
| [lightning/userConsentCookie](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-user-consent-cookie) | [ ] | limitation | reference page: for Experience Builder sites only, and needs cookie consent on in Security and Privacy settings; Experience Cloud, out of scope for this fixture |
| lightning/actions: CloseActionScreenEvent (closes a quick action panel) | [x] | deployed |  |

## lwc: target

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning__UrlAddressable: an LWC opened by its own URL](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [x] | deployed |  |
| [Target lightningCommunity__Page](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Target lightningCommunity__Default](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Target lightningCommunity__Page_Layout](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Target lightningCommunity__Theme_Layout](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Target lightningSnapin__ChatHeader](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightningSnapin__ChatMessage](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightningSnapin__MessagingPreChat](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightningSnapin__MessagingHeader](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightningSnapin__Minimized](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightningSnapin__PreChat](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Embedded Service chat and messaging, not Lightning Experience |
| [Target lightning__AgentforceInput](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Agentforce agent actions; "agent actions for accepting user input" |
| [Target lightning__AgentforceOutput](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Agentforce agent actions; "for displaying output data" |
| [Target lightning__Inbox](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | Outlook and Gmail integration, outside Lightning Experience |
| [Target analytics__Dashboard](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs CRM Analytics |
| [Target lightning__ECSFSApp](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Field Service |
| [Target lightning__ServiceDocument](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Field Service |
| [Target lightning_VoiceExtension](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Service Cloud Voice; spelled with one underscore on the page |
| [Target lightning__EnablementProgram](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | needs Enablement |
| [Target lightningStatic__Email](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | a builder, not a runtime page: Email Content Builder |
| [Target lightning__PropertyEditor](https://developer.salesforce.com/docs/platform/lwc/guide/reference-configuration-tags.html) | [ ] | limitation | a builder, not a runtime page: a custom property editor inside a builder |

## lwc: custom component rendering

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Light DOM component (lwc:render-mode="light") | [x] | deployed |  |
| Slotted content from a parent component | [x] | deployed |  |
| Dynamic component (lwc:component lwc:is) | [x] | deployed |  |
| Third-party library output: a canvas or SVG chart loaded with platformResourceLoader | [x] | deployed |  |
| Native HTML controls no base component wraps: dialog, details, contenteditable, HTML5 drag and drop, an iframe to a static resource | [x] | deployed |  |

## lwc: lightning-datatable interaction

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning-datatable: infinite loading](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [x] | deployed |  |
| [lightning-datatable: header actions and wrap text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [x] | deployed |  |
| [lightning-datatable: column resize](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [ ] | deployed |  |
| [lightning-datatable: single-row selection with a radio button (max-row-selection 1)](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [x] | deployed |  |
| [lightning-datatable: a custom data type](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightning-datatable) | [x] | deployed |  |

## lwc: hosted outside Lightning Experience

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Lightning Out 2.0: an LWC hosted in an external app](https://help.salesforce.com/s/articleView?id=platform.lightning_out_intro.htm&type=5) | [ ] | limitation | outside Lightning Experience; page title read from the Help table of contents, body not read |
