# Aura: what sf-tester can test

- Break run sha: 87463b99d83930d28df8dfecc4809be3e3a27c6e
- Break run date: 2026-11-14
- Break run users: admin (all rows); Probe Breaker (115 of the 506 deployed rows); Probe Platform (50 of the 200 in fixture rows)

120 driven, 45 seen, of 273 components.

Generated from `test/fixture-components/manifest.md`. A box is ticked only when a break run has driven the component with sf-tester's tools; `seen` means it was only seen on the page.

## aura: lightning components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning:accordionSection](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-accordion-section) | [x] | deployed |  |
| [lightning:accordion](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-accordion) | [x] | deployed |  |
| [lightning:alert](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-alert) | [ ] | deployed |  |
| [lightning:avatar](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-avatar) | [x] | deployed |  |
| [lightning:badge](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-badge) | [x] | deployed |  |
| [lightning:breadcrumb](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-breadcrumb) | [x] | deployed |  |
| [lightning:breadcrumbs](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-breadcrumbs) | [x] | deployed |  |
| [lightning:buttonGroup](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button-group) | [x] | deployed |  |
| [lightning:buttonIconStateful](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button-icon-stateful) | [x] | deployed |  |
| [lightning:buttonIcon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button-icon) | [x] | deployed |  |
| [lightning:buttonMenu](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button-menu) | [ ] | deployed |  |
| [lightning:buttonStateful](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button-stateful) | [x] | deployed |  |
| [lightning:button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-button) | [x] | deployed |  |
| [lightning:card](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-card) | [ ] | deployed |  |
| [lightning:carouselImage](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-carousel-image) | [ ] | deployed |  |
| [lightning:carousel](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-carousel) | [ ] | deployed |  |
| [lightning:checkboxGroup](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-checkbox-group) | [x] | deployed |  |
| [lightning:clickToDial](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-click-to-dial) | [ ] | deployed |  |
| [lightning:combobox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-combobox) | [x] | deployed |  |
| [lightning:confirm](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-confirm) | [ ] | deployed |  |
| [lightning:container](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-container) | [x] | deployed |  |
| [lightning:conversationToolkitAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-conversation-toolkit-api) | [ ] | not UI | conversation API component, renders nothing |
| [lightning:datatable](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-datatable) | [ ] | deployed |  |
| [lightning:dualListbox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-dual-listbox) | [x] | deployed |  |
| [lightning:dynamicIcon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-dynamic-icon) | [x] | deployed |  |
| [lightning:empApi](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-emp-api) | [ ] | not UI | data-only component (streaming API), renders nothing |
| [lightning:fileCard](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-file-card) | [x] | deployed |  |
| [lightning:fileUpload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-file-upload) | [x] | deployed |  |
| [lightning:flexipageRegionInfo](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-flexipage-region-info) | [ ] | not UI | gives the region width to its parent, renders nothing |
| [lightning:flow](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-flow) | [x] | deployed |  |
| [lightning:formattedAddress](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-address) | [x] | deployed |  |
| [lightning:formattedDateTime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-date-time) | [x] | deployed |  |
| [lightning:formattedEmail](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-email) | [x] | deployed |  |
| [lightning:formattedLocation](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-location) | [x] | deployed |  |
| [lightning:formattedName](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-name) | [x] | deployed |  |
| [lightning:formattedNumber](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-number) | [x] | deployed |  |
| [lightning:formattedPhone](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-phone) | [x] | deployed |  |
| [lightning:formattedRichText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-rich-text) | [x] | deployed |  |
| [lightning:formattedText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-text) | [x] | deployed |  |
| [lightning:formattedTime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-time) | [x] | deployed |  |
| [lightning:formattedUrl](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-formatted-url) | [ ] | deployed |  |
| [lightning:helptext](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-helptext) | [x] | deployed |  |
| [lightning:icon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-icon) | [x] | deployed |  |
| [lightning:inputAddress](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input-address) | [ ] | deployed |  |
| [lightning:inputField](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input-field) | [x] | deployed |  |
| [lightning:inputLocation](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input-location) | [ ] | deployed |  |
| [lightning:inputName](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input-name) | [ ] | deployed |  |
| [lightning:inputRichText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input-rich-text) | [ ] | deployed |  |
| [lightning:input](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-input) | [x] | deployed |  |
| [lightning:insertImageButton](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-insert-image-button) | [ ] | deployed |  |
| [lightning:layoutItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-layout-item) | [ ] | deployed |  |
| [lightning:layout](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-layout) | [ ] | deployed |  |
| [lightning:listView](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-list-view) | [ ] | deployed |  |
| [lightning:map](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-map) | [x] | deployed |  |
| [lightning:menuDivider](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-menu-divider) | [ ] | deployed |  |
| [lightning:menuItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-menu-item) | [ ] | deployed |  |
| [lightning:menuSubheader](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-menu-subheader) | [ ] | deployed |  |
| [lightning:messageChannel](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-message-channel) | [ ] | not UI | data-only component (Lightning Message Service), renders nothing |
| [lightning:navigationItemAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-navigation-item-api) | [ ] | not UI | API component, renders nothing |
| [lightning:navigation](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-navigation) | [x] | deployed |  |
| [lightning:notificationsLibrary](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-notifications-library) | [ ] | deployed |  |
| [lightning:omniToolkitAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-toolkit-api) | [ ] | not UI | Omni-Channel API component, renders nothing |
| [lightning:outputField](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-output-field) | [ ] | deployed |  |
| [lightning:overlayLibrary](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-overlay-library) | [x] | deployed |  |
| [lightning:pageReferenceUtils](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-page-reference-utils) | [ ] | not UI | utility component, renders nothing |
| [lightning:path](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-path) | [x] | deployed |  |
| [lightning:picklistPath](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-picklist-path) | [x] | deployed |  |
| [lightning:pillContainer](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-pill-container) | [x] | deployed |  |
| [lightning:pill](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-pill) | [x] | deployed |  |
| [lightning:progressBar](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-progress-bar) | [x] | deployed |  |
| [lightning:progressIndicator](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-progress-indicator) | [x] | deployed |  |
| [lightning:progressRing](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-progress-ring) | [ ] | deployed |  |
| [lightning:progressStep](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-progress-step) | [ ] | deployed |  |
| [lightning:prompt](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-prompt) | [x] | deployed |  |
| [lightning:quickActionAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-quick-action-api) | [ ] | not UI | API component, renders nothing |
| [lightning:quipCard](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-quip-card) | [x] | deployed |  |
| [lightning:radioGroup](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-radio-group) | [x] | deployed |  |
| [lightning:recordEditForm](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-record-edit-form) | [x] | deployed |  |
| [lightning:recordForm](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-record-form) | [x] | deployed |  |
| [lightning:recordViewForm](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-record-view-form) | [ ] | deployed |  |
| [lightning:relativeDateTime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-relative-date-time) | [x] | deployed |  |
| [lightning:select](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-select) | [ ] | deployed |  |
| [lightning:slider](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-slider) | [x] | deployed |  |
| [lightning:spinner](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-spinner) | [x] | deployed |  |
| [lightning:tab](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab) | [x] | deployed |  |
| [lightning:tabset](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tabset) | [x] | deployed |  |
| [lightning:textarea](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-textarea) | [ ] | deployed |  |
| [lightning:tile](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tile) | [ ] | deployed |  |
| [lightning:treeGrid](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tree-grid) | [x] | deployed |  |
| [lightning:tree](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tree) | [x] | deployed |  |
| [lightning:unsavedChanges](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-unsaved-changes) | [x] | deployed |  |
| [lightning:utilityBarAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-utility-bar-api) | [ ] | not UI | API component, renders nothing; the utility bar is rows A2-027 to A2-044 |
| [lightning:verticalNavigationItemBadge](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation-item-badge) | [x] | deployed |  |
| [lightning:verticalNavigationItemIcon](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation-item-icon) | [ ] | deployed |  |
| [lightning:verticalNavigationItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation-item) | [ ] | deployed |  |
| [lightning:verticalNavigationOverflow](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation-overflow) | [x] | deployed |  |
| [lightning:verticalNavigationSection](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation-section) | [ ] | deployed |  |
| [lightning:verticalNavigation](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-vertical-navigation) | [ ] | deployed |  |
| [lightning:workspaceAPI](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-workspace-api) | [ ] | not UI | API component, renders nothing; the console tabs it drives are rows A2-017 to A2-025 |

## aura: lightning events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning:conversationAgentSend](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-conversation-agent-send) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:conversationChatEnded](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-conversation-chat-ended) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:conversationCustomEvent](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-conversation-custom-event) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:conversationNewMessage](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-conversation-new-message) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelConnectionError](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-connection-error) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelLoginSuccess](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-login-success) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelLogout](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-logout) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelStatusChanged](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-status-changed) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkAccepted](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-work-accepted) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkAssigned](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-work-assigned) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkClosed](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-work-closed) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkDeclined](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-work-declined) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkFlagUpdated](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-work-flag-updated) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:omniChannelWorkloadChanged](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-omni-channel-workload-changed) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:openFiles](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-open-files) | [ ] | deployed |  |
| [lightning:sendChatterExtensionPayload](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-send-chatter-extension-payload) | [ ] | not UI | event: framework or app event, renders nothing |
| [lightning:tabClosed](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-closed) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:tabCreated](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-created) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:tabFocused](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-focused) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:tabRefreshed](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-refreshed) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:tabReplaced](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-replaced) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |
| [lightning:tabUpdated](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-tab-updated) | [ ] | not UI | event: Omni-Channel, conversation or workspace tab notice, renders nothing |

## aura: lightning interfaces

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightning:actionOverride](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-action-override) | [x] | deployed |  |
| [lightning:appHomeTemplate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-app-home-template) | [x] | deployed |  |
| [lightning:availableForChatterExtensionComposer](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-available-for-chatter-extension-composer) | [ ] | limitation | Experience Cloud, out of scope for this fixture: Rich Publisher Apps show only in Experience Builder site feeds ("This interface is available in Experience Builder sites"); a probe composer, renderer and ChatterExtension (with a ContentAsset icon) passed validate 0AfQL00000tyFHR0A2 |
| [lightning:availableForChatterExtensionRenderer](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-available-for-chatter-extension-renderer) | [ ] | limitation | Experience Cloud, out of scope for this fixture: Rich Publisher Apps show only in Experience Builder site feeds ("This interface is available in Experience Builder sites"); a probe composer, renderer and ChatterExtension (with a ContentAsset icon) passed validate 0AfQL00000tyFHR0A2 |
| [lightning:availableForFlowActions](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-available-for-flow-actions) | [x] | deployed |  |
| [lightning:availableForFlowScreens](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-available-for-flow-screens) | [x] | deployed |  |
| [lightning:availableForForecastingPage](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-available-for-forecasting-page) | [ ] | limitation | needs Salesforce Forecasting, see A1-062 |
| [lightning:backgroundUtilityItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-background-utility-item) | [ ] | deployed |  |
| [lightning:forecastingTemplate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-forecasting-template) | [ ] | limitation | needs Salesforce Forecasting, see A1-062 |
| [lightning:hasPageReference](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-has-page-reference) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |
| [lightning:homeTemplate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-home-template) | [x] | deployed |  |
| [lightning:isUrlAddressable](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-is-url-addressable) | [x] | deployed |  |
| [lightning:recordHomeTemplate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-record-home-template) | [x] | deployed |  |
| [lightning:utilityItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-utility-item) | [x] | deployed |  |

## aura: ui components (deprecated)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [ui:actionMenuItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-action-menu-item) | [x] | deployed |  |
| [ui:button](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-button) | [x] | deployed |  |
| [ui:checkboxMenuItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-checkbox-menu-item) | [x] | deployed |  |
| [ui:inputCheckbox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-checkbox) | [x] | deployed |  |
| [ui:inputCurrency](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-currency) | [x] | deployed |  |
| [ui:inputDateTime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-date-time) | [x] | deployed |  |
| [ui:inputDate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-date) | [x] | deployed |  |
| [ui:inputDefaultError](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-default-error) | [x] | deployed |  |
| [ui:inputEmail](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-email) | [x] | deployed |  |
| [ui:inputNumber](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-number) | [x] | deployed |  |
| [ui:inputPhone](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-phone) | [x] | deployed |  |
| [ui:inputRadio](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-radio) | [x] | deployed |  |
| [ui:inputRichText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-rich-text) | [ ] | deployed |  |
| [ui:inputSecret](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-secret) | [x] | deployed |  |
| [ui:inputSelectOption](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-select-option) | [ ] | deployed |  |
| [ui:inputSelect](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-select) | [ ] | deployed |  |
| [ui:inputTextArea](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-text-area) | [x] | deployed |  |
| [ui:inputText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-text) | [x] | deployed |  |
| [ui:inputURL](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-input-url) | [x] | deployed |  |
| [ui:menuItemSeparator](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-item-separator) | [x] | deployed |  |
| [ui:menuItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-item) | [ ] | deployed |  |
| [ui:menuList](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-list) | [x] | deployed |  |
| [ui:menuTriggerLink](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-trigger-link) | [x] | deployed |  |
| [ui:menuTrigger](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-trigger) | [ ] | deployed |  |
| [ui:menu](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu) | [x] | deployed |  |
| [ui:message](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-message) | [x] | deployed |  |
| [ui:outputCheckbox](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-checkbox) | [x] | deployed |  |
| [ui:outputCurrency](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-currency) | [x] | deployed |  |
| [ui:outputDateTime](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-date-time) | [x] | deployed |  |
| [ui:outputDate](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-date) | [x] | deployed |  |
| [ui:outputEmail](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-email) | [x] | deployed |  |
| [ui:outputNumber](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-number) | [x] | deployed |  |
| [ui:outputPhone](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-phone) | [x] | deployed |  |
| [ui:outputRichText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-rich-text) | [x] | deployed |  |
| [ui:outputTextArea](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-text-area) | [x] | deployed |  |
| [ui:outputText](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-text) | [x] | deployed |  |
| [ui:outputURL](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-output-url) | [x] | deployed |  |
| [ui:radioMenuItem](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-radio-menu-item) | [x] | deployed |  |
| [ui:scrollerWrapper](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-scroller-wrapper) | [x] | deployed |  |
| [ui:spinner](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-spinner) | [x] | deployed |  |

## aura: ui events (deprecated namespace)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [ui:clearErrors](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-clear-errors) | [ ] | not UI | event: framework or app event, renders nothing |
| [ui:collapse](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-collapse) | [ ] | not UI | event: framework or app event, renders nothing |
| [ui:expand](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-expand) | [ ] | not UI | event: framework or app event, renders nothing |
| [ui:menuFocusChange](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-focus-change) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |
| [ui:menuSelect](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-select) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |
| [ui:menuTriggerPress](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-menu-trigger-press) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |
| [ui:validationError](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ui-validation-error) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |

## aura: force components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [force:canvasApp](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-canvas-app) | [ ] | limitation | needs a Canvas app (a connected app with Canvas), see A4-010 |
| [force:inputField](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-input-field) | [x] | deployed |  |
| [force:outputField](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-output-field) | [x] | deployed |  |
| [force:recordData](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-record-data) | [ ] | not UI | data-only component, renders nothing |
| [force:recordEdit](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-record-edit) | [x] | deployed |  |
| [force:recordView](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-record-view) | [x] | deployed |  |

## aura: force events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [force:closeQuickAction](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-close-quick-action) | [x] | deployed |  |
| [force:createRecord](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-create-record) | [ ] | deployed |  |
| [force:editRecord](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-edit-record) | [ ] | deployed |  |
| [force:navigateHome](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-home) | [x] | deployed |  |
| [force:navigateToComponent](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-component) | [x] | deployed |  |
| [force:navigateToList](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-list) | [x] | deployed |  |
| [force:navigateToObjectHome](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-object-home) | [x] | deployed |  |
| [force:navigateToRelatedList](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-related-list) | [x] | deployed |  |
| [force:navigateToSObject](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-sobject) | [ ] | deployed |  |
| [force:navigateToURL](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-navigate-to-url) | [x] | deployed |  |
| [force:recordSaveSuccess](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-record-save-success) | [ ] | not UI | event: a notice after a save, changes nothing a user sees |
| [force:recordSave](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-record-save) | [x] | deployed |  |
| [force:refreshView](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-refresh-view) | [x] | deployed |  |
| [force:showToast](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-show-toast) | [x] | deployed |  |

## aura: force interfaces

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [force:appHostable](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-app-hostable) | [x] | deployed |  |
| [force:hasRecordId](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-has-record-id) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |
| [force:hasSObjectName](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-has-sobject-name) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |
| [force:lightningQuickActionWithoutHeader](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-lightning-quick-action-without-header) | [x] | deployed |  |
| [force:lightningQuickAction](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/force-lightning-quick-action) | [x] | deployed |  |

## aura: forceChatter components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [forceChatter:feed](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceChatter-feed) | [x] | deployed |  |
| [forceChatter:fullFeed](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceChatter-full-feed) | [x] | deployed |  |
| [forceChatter:publisher](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceChatter-publisher) | [ ] | deployed |  |

## aura: forceChatter events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [forceChatter:customOpenFile](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceChatter-custom-open-file) | [ ] | not UI | event: framework or app event, renders nothing |
| [forceChatter:postCreated](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceChatter-post-created) | [ ] | not UI | event: framework or app event, renders nothing |

## aura: wave components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [wave:sdk](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-sdk) | [ ] | not UI | CRM Analytics API component, renders nothing |
| [wave:waveDashboard](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-wave-dashboard) | [ ] | limitation | needs CRM Analytics: the org has none, GET /wave/dashboards answers FUNCTIONALITY_NOT_ENABLED "This feature is not currently enabled for this user type or org: [Wave]", so there is no dashboard to show; validate 0AfQL00000tyFHR0A2 accepted the markup in a probe |

## aura: wave events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [wave:assetLoaded](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-asset-loaded) | [ ] | not UI | event: framework or app event, renders nothing |
| [wave:discoverResponse](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-discover-response) | [ ] | not UI | event: framework or app event, renders nothing |
| [wave:discover](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-discover) | [ ] | not UI | event: framework or app event, renders nothing |
| [wave:pageChange](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-page-change) | [ ] | not UI | event: framework or app event, renders nothing |
| [wave:selectionChanged](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-selection-changed) | [ ] | not UI | event: framework or app event, renders nothing |
| [wave:update](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/wave-update) | [ ] | not UI | event: framework or app event, renders nothing |

## aura: ltng components

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [ltng:require](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-require) | [ ] | not UI | loads scripts and styles, renders nothing |

## aura: ltng events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [ltng:afterScriptsLoaded](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-after-scripts-loaded) | [ ] | not UI | event: framework or app event, renders nothing |
| [ltng:beforeLoadingResources](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-before-loading-resources) | [ ] | not UI | event: framework or app event, renders nothing |
| [ltng:selectSObject](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-select-sobject) | [ ] | not UI | event: framework or app event, renders nothing |
| [ltng:sendMessage](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-send-message) | [ ] | not UI | event: framework or app event, renders nothing |

## aura: ltng interfaces

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [ltng:allowGuestAccess](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/ltng-allow-guest-access) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |

## aura: flexipage interfaces

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [flexipage:availableForAllPageTypes](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/flexipage-available-for-all-page-types) | [ ] | deployed |  |
| [flexipage:availableForRecordHome](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/flexipage-available-for-record-home) | [ ] | deployed |  |

## aura: clients interfaces

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [clients:availableForMailAppAppPage](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/clients-available-for-mail-app-app-page) | [ ] | limitation | needs the Outlook or Gmail integration, see A1-065 |
| [clients:hasEventContext](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/clients-has-event-context) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |
| [clients:hasItemContext](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/clients-has-item-context) | [ ] | not UI | interface: gives the component data, changes nothing a user sees |

## aura: aura framework markup

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [aura:component](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-component) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:expression](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-expression) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:html](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-html) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:if](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-if) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:iteration](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-iteration) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:renderIf](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-render-if) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own; deprecated |
| [aura:template](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-template) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:text](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-text) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |
| [aura:unescapedHtml](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-unescaped-html) | [ ] | not UI | framework markup: renders its children or plain text, no component of its own |

## aura: aura framework events

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [aura:applicationEvent](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-application-event) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:componentEvent](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-component-event) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:doneRendering](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-done-rendering) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |
| [aura:doneWaiting](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-done-waiting) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |
| [aura:locationChange](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-location-change) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:methodCall](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-method-call) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:noAccess](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-no-access) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:systemError](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-system-error) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:valueChange](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-value-change) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:valueDestroy](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-value-destroy) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:valueEvent](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-value-event) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:valueInit](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-value-init) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:valueRender](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-value-render) | [ ] | not UI | event: framework or app event, renders nothing |
| [aura:waiting](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/aura-waiting) | [ ] | not UI | event: framework or app event, renders nothing; deprecated |

## aura: forceCommunity (Experience Cloud)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [forceCommunity:analyticsInteractionGtag](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-analytics-interaction-gtag) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:analyticsInteraction](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-analytics-interaction) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:appLauncher](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-app-launcher) | [ ] | limitation | Experience Cloud, out of scope for this fixture; beta |
| [forceCommunity:availableForAllPageTypes](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-available-for-all-page-types) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:layout](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-layout) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:navigationMenuBase](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-navigation-menu-base) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:notifications](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-notifications) | [ ] | limitation | Experience Cloud, out of scope for this fixture; beta |
| [forceCommunity:profileMenuInterface](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-profile-menu-interface) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:routeChange](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-route-change) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:routeLink](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-route-link) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:searchInterface](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-search-interface) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:themeLayout](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-theme-layout) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [forceCommunity:waveDashboard](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/forceCommunity-wave-dashboard) | [ ] | limitation | Experience Cloud, out of scope for this fixture |

## aura: lightningcommunity (Experience Cloud)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [lightningcommunity:allowInRelaxedCsp](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightningcommunity-allow-in-relaxed-csp) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [lightningcommunity:backButton](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightningcommunity-back-button) | [ ] | limitation | Experience Cloud, out of scope for this fixture; beta |
| [lightningcommunity:deflectionSignal](https://developer.salesforce.com/docs/platform/lightning-component-reference/guide/lightningcommunity-deflection-signal) | [ ] | limitation | Experience Cloud, out of scope for this fixture |

## aura: hosted outside one.app

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| An Aura component in a Visualforce page with Lightning Out ($Lightning.use) | [x] | deployed |  |
| A standalone Aura app (.app) opened by its URL | [ ] | deployed |  |

## aura: lightningsnapin (Embedded Service)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| lightningsnapin: namespace (embedded chat pre-chat and minimized components) | [ ] | limitation | Embedded Service, not Lightning Experience; unverified: no doc page found (2026-11-14), not in the reference index |
