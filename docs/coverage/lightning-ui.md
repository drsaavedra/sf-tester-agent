# Lightning UI: what sf-tester can test

- Break run sha: 87463b99d83930d28df8dfecc4809be3e3a27c6e
- Break run date: 2026-11-14
- Break run users: admin (all rows); Probe Breaker (115 of the 506 deployed rows); Probe Platform (50 of the 200 in fixture rows)

173 driven, 74 seen, of 492 components.

Generated from `test/fixture-components/manifest.md`. A box is ticked only when a break run has driven the component with sf-tester's tools; `seen` means it was only seen on the page.

## App Builder component

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Accordion](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Actions & Recommendations](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Activities](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [After Conversation Work (Beta) (needs: Voice Call channels)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Voice Call channels, scratch def features is empty |
| [App Launcher](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | deployed |  |
| [Blank Space](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Call Recording Player (needs: Service Cloud Voice)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Service Cloud Voice, scratch def features is empty |
| [Chatter](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Chatter Feed](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Chatter Publisher](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Conversation Body (needs: Service Cloud Voice)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Service Cloud Voice, scratch def features is empty |
| [CRM Analytics Collection](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs CRM Analytics; wave:collection tried in slice 3 ("We couldn't retrieve the design time component information") |
| [LWC CRM Analytics Dashboard](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | unsure: CRM Analytics license likely needed; the deploy of SfUiC_Unsure_App_Page succeeded, but no sfui-s4 org kept wave:waveDashboardLwc: a retrieve of the page from each of the four orgs on 2026-11-13 holds one component where the tree holds two. Not measured: that the licence is the cause |
| [CRM Analytics Dashboard](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | unsure: CRM Analytics license likely needed; Invalid component [wave:waveDashboard]: missing required property [dashboardId]. The component exists, but a dashboard id needs a CRM Analytics dashboard, which needs the licence |
| [Dynamic Actions Bar (Pilot)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | pilot component, needs the Dynamic Actions Bar pilot; runtime_platform_actions:dynamicActionsBar tried in slice 3 |
| [Dynamic Highlights Panel](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | in fixture |  |
| [Dynamic Related List - Single](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Einstein Field Recommendations (needs: Einstein Case Classification or Case Wrap-Up)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Einstein Case Classification or Case Wrap-Up, scratch def features is empty |
| [Einstein GPT Sales Emails (needs: Sales Emails, Gmail or Outlook integration)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Sales Emails and Gmail or Outlook integration, scratch def features is empty |
| [Einstein Next Best Action](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Einstein Predictions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | runtime_einstein_discovery:einsteinDiscoveryPanel (source https://github.com/flemx/Automotive-acceleration-kit/blob/HEAD/force-app/main/default/flexipages/Case_Record_Page.flexipage-meta.xml): "Your org doesn't have access to component ..."; needs Einstein Discovery (CRM Analytics Plus) |
| [Einstein Replies (needs: Einstein Reply Recommendations)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Einstein Reply Recommendations, scratch def features is empty |
| [Forecasts Header](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | runtime_sales_forecasting:forecastingHeaderPanel on a ForecastingPage, template runtime_sales_forecasting:defaultForecastingPageTemplate (source https://github.com/kishankachhadiyakk/Nile-Global/blob/HEAD/force-app/main/default/flexipages/Forecasts_Page_Default.flexipage-meta.xml): "This org does not have access to Lightning pages of type ForecastingPage"; on an app page "isn't allowed in the column1 region"; needs Collaborative Forecasts |
| [Forecasts Opportunity List](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | runtime_sales_forecasting:forecastingOppListPanel on a ForecastingPage, template runtime_sales_forecasting:defaultForecastingPageTemplate (source https://github.com/kishankachhadiyakk/Nile-Global/blob/HEAD/force-app/main/default/flexipages/Forecasts_Page_Default.flexipage-meta.xml): "This org does not have access to Lightning pages of type ForecastingPage"; on an app page "isn't allowed in the column1 region"; needs Collaborative Forecasts |
| [Forecasts Summary](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | runtime_sales_forecasting:forecastingSummaryViewPanel on a ForecastingPage, template runtime_sales_forecasting:defaultForecastingPageTemplate (source https://github.com/kishankachhadiyakk/Nile-Global/blob/HEAD/force-app/main/default/flexipages/Forecasts_Page_Default.flexipage-meta.xml): "This org does not have access to Lightning pages of type ForecastingPage"; on an app page "isn't allowed in the column1 region"; needs Collaborative Forecasts |
| [Grid (needs: Field Service and Revenue Cloud license)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Field Service and Revenue Cloud license, scratch def features is empty |
| [Highlights Panel](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [List View](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Orchestration Work Guide](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Order Product Summaries by Recipient (needs: Salesforce Order Management)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Salesforce Order Management, scratch def features is empty |
| [Order Summary Totals (needs: Salesforce Order Management)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Salesforce Order Management, scratch def features is empty |
| [Phone (needs: Service Cloud Voice, Contact Center Agent permission set)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Service Cloud Voice and Contact Center Agent permission set, scratch def features is empty |
| [Quip Document](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | Quip:Quip (source https://github.com/fschiozerSFDC/fschiozer-orgdevmode-cicd/blob/HEAD/force-app/main/default/flexipages/Project_Record_Page.flexipage-meta.xml) and quip:document (slice 3) both "We couldn't retrieve the design time component information"; needs Quip |
| [Rebate Types Panel (needs: Rebate Management license)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Rebate Management license, scratch def features is empty |
| [Rebate Types Tab (needs: Rebate Management license)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Rebate Management license, scratch def features is empty |
| [Recent Items](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Record Detail](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Related List - Single](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Related List Quick Links](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Related Lists](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Related Record](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | deployed |  |
| [Report Chart](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Rich Text](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Request Approvals](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | not the same component as A1-165 Request Approval: this is runtime_approvals:approvalsWorkflowComponent (flow approvals), A1-165 is interaction_orchestrator:requestApprovalHome, which shows a Start button here; runtime_approvals:approvalsWorkflowComponent (source https://github.com/bgaldino/rlm-base-dev/blob/HEAD/templates/flexipages/base/RLM_Quote_Record_Page.flexipage-meta.xml): first "missing required property [flowApiName]", then with a flowApiName "Your org doesn't have access to component runtime_approvals:approvalsWorkflowComponent"; needs flow approvals (approval orchestration), not on this org |
| [Salesforce Surveys (needs: Salesforce Surveys enabled)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Salesforce Surveys enabled, scratch def features is empty |
| [Send Email Later - Pending List](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | lightningInbox:sendLaterListContainer (source https://github.com/rtuck2014/2022-05-24---HL-DEV/blob/HEAD/force-app/main/default/flexipages/HVS_Home_Page.flexipage-meta.xml, a Home page): app page column1 "isn't allowed in the column1 region", Home sidebar "Your org doesn't have access to component lightningInbox:sendLaterListContainer"; needs Send Email Later (Einstein Activity Capture or inbox feature) |
| [Tabs](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Twitter (needs: Social Accounts and Contacts)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | placed on an Account page and shows nothing under its label on a plain org (render check 2026-11-14); was limitation: needs Social Accounts and Contacts, scratch def features is empty; also offered on the Record palette of Account, Contact, Lead; the API name runtime_sales_social:socialPanel does not match the label; App Builder saved it on an Account record page (preview "Insufficient permissions"), name read from App Builder on a scratch org, 2026-11-14 |
| [Visualforce Page](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Voice Status](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | limitation | needs Service Cloud Voice; runtime_service_voice:voiceStatus tried in slice 3 |
| [Path component (not on the Help list, which is partial)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | in fixture |  |
| [Flow component (not on the Help list, which is partial)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Field Section component, Dynamic Forms (not on the Help list, which is partial)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | in fixture |  |
| [Dashboard component (not on the Help list, which is partial)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Assistant, Key Deals, Today's Events, Today's Tasks, Performance (five Home page components on one page; not on the Help list)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |
| [Topics, Trending Topics, Launchpad (not on the Help list; names unverified; Recommendations is A1-020)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | deployed |  |

## page type

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [App Page (AppPage)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | in fixture |  |
| [Home Page (HomePage)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | deployed |  |
| [Record Page (RecordPage)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | in fixture |  |
| [Utility bar page (UtilityBar, Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | in fixture |  |
| [Quick Action Page (QuickAction, Beta, API 68.0+)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [x] | deployed |  |
| [Forecasts Page (ForecastingPage; needs: Salesforce Forecasting)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | limitation | needs Salesforce Forecasting, scratch def features is empty |
| [Command Center Page (needs: Command Center, Enhanced Omni-Channel)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | limitation | needs Command Center and Enhanced Omni-Channel, scratch def features is empty |
| [Omni Supervisor Page (OmniSupervisorPageType; needs: Enhanced Omni-Channel)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | limitation | needs Enhanced Omni-Channel, scratch def features is empty |
| [Email Application Pane (MailAppAppPage; Outlook and Gmail)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_types.htm&type=5) | [ ] | limitation | Outlook and Gmail email application pane, not Lightning Experience |
| [CdpRecordPage (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | unsure: CdpRecordPage likely needs Data Cloud; This org does not have access to Lightning pages of type CdpRecordPage. |
| [EmbeddedServicePage (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | template embeddedService:embeddedServicePageTemplateDefault (source https://github.com/amit1365/udLWC/blob/HEAD/force-app/main/default/flexipages/test.flexipage-meta.xml, where sobjectType is ServiceAppointment); built on SfUiC_Shape__c; empty header and main regions; the page SfUiC_Embedded_Page is on the orgs as metadata, but nothing in Lightning Experience opens an EmbeddedServicePage, so a tester cannot reach it |
| [EmailContentPage (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | This org does not have access to Lightning pages of type EmailContentPage. |
| [EmailTemplatePage (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | You don't have the right to create Lightning pages of type EmailTemplatePage. |
| [RecordPreview (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | This org does not have access to Lightning pages of type RecordPreview. |
| [VoiceExtension (Metadata API only)](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_flexipage.htm) | [ ] | limitation | unsure: VoiceExtension likely needs Service Cloud Voice; This org does not have access to Lightning pages of type VoiceExtension. |

## page template (names are not on the Help page; from the App Builder picker, unverified)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Record: Header and Right Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | in fixture |  |
| [Record: Header and Left Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Header, Subheader, Right Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Header, Subheader, Left Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Header and Two Equal Regions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Header and Three Regions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Header, Subheader, Three Regions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | not UI | App Builder lists no such template (18 record templates read on 2026-11-13) |
| [Record: One Region](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [Record: Pinned Header](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [Record: Pinned Left Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [Record: Pinned Left and Right Sidebars](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [Record: Pinned Header and Left Sidebar (three regions)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Home: Standard Home Page (three regions)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [Home: Header and Right Sidebar, and Header and Three Regions (two templates)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [ ] | deployed |  |
| [App: One Region](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | in fixture |  |
| [App: Two Regions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [App: Header and Left Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [App: Header and Right Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [App: Header and Three Regions](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [App: Main Region and Right Sidebar](https://help.salesforce.com/s/articleView?id=platform.lightning_page_templates.htm&type=5) | [x] | deployed |  |
| [Record: Pinned Right Sidebar (three regions)](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_pages.htm&type=5) | [ ] | deployed |  |

## field type

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Address (custom address field)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Auto Number](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Checkbox](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | in fixture |  |
| [Currency](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Date](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | in fixture |  |
| [Date/Time](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | in fixture |  |
| [Email](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [External Lookup Relationship](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | limitation | needs an external object (Salesforce Connect), which a Developer edition scratch org with no features does not have |
| [Formula (return types Checkbox, Currency, Date, Date/Time, Number, Percent, Text, Time; the list is not on the Help page)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Geolocation](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | in fixture |  |
| [Hierarchical Relationship](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | built |  |
| [Indirect Lookup Relationship](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | limitation | an indirect lookup can be created only on an external object (Salesforce Connect), not available here |
| [Lookup Relationship](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | in fixture |  |
| [Master-Detail Relationship](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | deployed |  |
| [Number](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | in fixture |  |
| [Percent](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Phone](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | deployed |  |
| [Picklist](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | in fixture |  |
| [Picklist (Multi-select)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | in fixture |  |
| [Roll-Up Summary](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Text](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | in fixture |  |
| [Text (Encrypted)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | deployed |  |
| [Text Area](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Text Area (Long)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Text Area (Rich)](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [ ] | deployed |  |
| [Time](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | in fixture |  |
| [URL](https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5) | [x] | deployed |  |
| [Picklist from a global value set](https://help.salesforce.com/s/articleView?id=platform.fields_creating_global_picklists.htm&type=5) | [x] | deployed |  |
| [Dependent picklist (controlling picklist)](https://help.salesforce.com/s/articleView?id=platform.fields_defining_field_dependencies.htm&type=5) | [ ] | in fixture |  |
| [Picklist values per record type](https://help.salesforce.com/s/articleView?id=platform.editing_picklists_for_record_types_and_business_processes.htm&type=5) | [x] | in fixture |  |
| Picklist with a restricted value set | [x] | in fixture |  |
| [Lookup with a lookup filter](https://help.salesforce.com/s/articleView?id=platform.fields_lookup_filters.htm&type=5) | [x] | deployed |  |
| Compound Name (standard, Contact or Lead) | [ ] | deployed |  |
| Compound Address (standard, Account or Contact) | [ ] | deployed |  |
| Polymorphic lookup (Owner; WhoId and WhatId on Task) | [ ] | deployed |  |
| [Dependent picklist with a controlling checkbox (split from A3-029, the fixture has only a controlling picklist)](https://help.salesforce.com/s/articleView?id=platform.fields_defining_field_dependencies.htm&type=5) | [x] | deployed |  |

## form surface

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Page layout: one-column and two-column sections, blank space, required and read-only field properties](https://help.salesforce.com/s/articleView?id=platform.customize_layoutcustomize_pd_elements.htm&type=5) | [x] | in fixture |  |
| [Page layout: collapsible section](https://help.salesforce.com/s/articleView?id=platform.customize_layoutcustomize_pd_elements.htm&type=5) | [x] | deployed |  |
| [Dynamic Forms: required and read-only fields](https://help.salesforce.com/s/articleView?id=platform.dynamic_forms_req_fields.htm&type=5) | [x] | in fixture |  |
| [Dynamic Forms: fields aligned horizontally in a Field Section](https://help.salesforce.com/s/articleView?id=platform.dynamic_forms_align_fields_horizonally.htm&type=5) | [ ] | deployed |  |
| [Component visibility rule on a Lightning page](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components_visibility.htm&type=5) | [ ] | in fixture |  |
| [Compact layout](https://help.salesforce.com/s/articleView?id=platform.compact_layout_overview.htm&type=5) | [ ] | deployed |  |
| [Path: Mark Status as Complete, pick a closed stage](https://help.salesforce.com/s/articleView?id=sales.path_create.htm&type=5) | [x] | deployed |  |
| [Inline edit on a record page](https://help.salesforce.com/s/articleView?id=platform.users_inline_editing.htm&type=5) | [x] | in fixture |  |
| [Field-level help text](https://help.salesforce.com/s/articleView?id=platform.customhelp_defining_field_level_help.htm&type=5) | [x] | deployed |  |
| [Field history tracking (history related list)](https://help.salesforce.com/s/articleView?id=platform.enable_user_field_history_tracking.htm&type=5) | [x] | deployed |  |
| [Duplicate rule alert on save](https://help.salesforce.com/s/articleView?id=sales.duplicate_rules_overview.htm&type=5) | [ ] | deployed |  |
| [Record type picker at create](https://help.salesforce.com/s/articleView?id=platform.creating_record_types.htm&type=5) | [x] | in fixture |  |
| Record edit modal | [x] | in fixture |  |
| New-record modal | [x] | in fixture |  |
| Save & New | [ ] | in fixture |  |
| Required-field and validation-rule error display on a form (field error, page-top error) | [x] | in fixture |  |
| [Path: key fields (split from A3-045, the fixture path has guidance only)](https://help.salesforce.com/s/articleView?id=sales.path_overview.htm&type=5) | [x] | deployed |  |

## overlay (the docs agent did not research this group; no Help pages)

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Toast variants: success, error, warning, info, sticky, with a link](https://developer.salesforce.com/docs/platform/lwc/guide/use-toast.md) | [ ] | deployed |  |
| Record hover card (lookup hover, compact layout fields) | [x] | in fixture |  |
| Lookup dropdown: recent, typeahead search, Show All Results modal, New record from the lookup | [x] | in fixture |  |
| Picklist dropdown on a record form | [ ] | in fixture |  |
| Multi-select picklist dual listbox on a record form | [x] | in fixture |  |
| Date picker on a record form | [ ] | in fixture |  |
| Time picker on a record form | [x] | in fixture |  |
| Date/time picker on a record form | [x] | in fixture |  |
| Help text bubble (tooltip) | [x] | in fixture |  |
| Docked composer (global action window: minimise, pop out, maximize) | [x] | deployed |  |
| In-App Guidance prompt: floating, docked (targeted and walkthrough not built) | [ ] | deployed |  |
| Standard confirmation dialog (Delete record) | [x] | in fixture |  |
| Page spinner and stencil while a page loads | [x] | in fixture |  |

## quick action type

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Create a Record, object-specific (type Create)](https://help.salesforce.com/s/articleView?id=platform.actions_overview.htm&type=5) | [ ] | deployed |  |
| [Create a Record, global (type Create)](https://help.salesforce.com/s/articleView?id=platform.actions_overview_global.htm&type=5) | [ ] | deployed |  |
| [Update a Record (type Update)](https://help.salesforce.com/s/articleView?id=platform.actions_overview.htm&type=5) | [ ] | in fixture |  |
| [Log a Call, object-specific (type LogACall)](https://help.salesforce.com/s/articleView?id=platform.actions_overview.htm&type=5) | [x] | deployed |  |
| [Log a Call, global (type LogACall)](https://help.salesforce.com/s/articleView?id=platform.actions_overview_global.htm&type=5) | [x] | deployed |  |
| [Send Email, object-specific (type SendEmail; Help says cases only)](https://help.salesforce.com/s/articleView?id=platform.actions_overview_object_specific.htm&type=5) | [x] | deployed |  |
| [Send Email, global (type SendEmail)](https://help.salesforce.com/s/articleView?id=platform.actions_overview_global.htm&type=5) | [x] | deployed |  |
| [Custom Visualforce, object-specific (type VisualforcePage)](https://help.salesforce.com/s/articleView?id=platform.actions_overview_object_specific.htm&type=5) | [x] | deployed |  |
| [Custom Visualforce, global (type VisualforcePage)](https://help.salesforce.com/s/articleView?id=platform.creating_global_actions.htm&type=5) | [x] | deployed |  |
| [Custom Canvas (type Canvas; needs: Canvas enabled)](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [ ] | limitation | needs Canvas enabled, scratch def features is empty |
| [Lightning Component, Aura (type LightningComponent)](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [LWC screen action (type LightningWebComponent, target ScreenAction)](https://help.salesforce.com/s/articleView?id=platform.lightning_web_component_actions.htm&type=5) | [x] | in fixture |  |
| [LWC headless action (type LightningWebComponent, target Action)](https://help.salesforce.com/s/articleView?id=platform.lightning_web_component_actions.htm&type=5) | [x] | deployed |  |
| [LWC global action (Help: Field Service mobile app only)](https://help.salesforce.com/s/articleView?id=platform.creating_global_actions.htm&type=5) | [ ] | limitation | row says Help: Field Service mobile app only |
| [Flow quick action (type Flow, screen flow)](https://help.salesforce.com/s/articleView?id=platform.actions_overview.htm&type=5) | [x] | in fixture |  |
| [Chatter Post (type Post) in the Chatter publisher; Poll and Question not placed](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [x] | deployed |  |
| [Chatter Announcement (groups only)](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [x] | deployed |  |
| [Social Post (type SocialPost)](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-quickaction.md) | [ ] | limitation | unsure: Social Post likely needs Social Accounts and Contacts; Cannot create a SocialPost QuickAction for non-case entities, or you don't have SocialObjects enabled (tried on Case) |
| [Chatter File, Link, Thanks (Help: Salesforce Classic)](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [ ] | limitation | row says Help: Salesforce Classic only |
| [Default actions: New Task, New Event (New Contact is A4-001)](https://help.salesforce.com/s/articleView?id=platform.default_actions_overview.htm&type=5) | [x] | deployed |  |
| [Productivity action: Send Email (Call, Map, View Website, Read News refused)](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [ ] | deployed |  |
| [Mobile smart actions (mobile only)](https://help.salesforce.com/s/articleView?id=platform.actions_types.htm&type=5) | [ ] | limitation | row says mobile only |

## other action shape

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Standard buttons Edit, Delete, Clone on a record page](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | in fixture |  |
| [Standard button Change Owner on a record page (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.customizing_detail_page_buttons.htm&type=5) | [ ] | deployed |  |
| [Standard button Change Record Type (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.customizing_detail_page_buttons.htm&type=5) | [ ] | deployed |  |
| [Standard button Sharing (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.customizing_detail_page_buttons.htm&type=5) | [x] | deployed |  |
| [Standard button Printable View (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.customizing_detail_page_buttons.htm&type=5) | [x] | in fixture |  |
| [Standard button Submit for Approval (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.customizing_detail_page_buttons.htm&type=5) | [x] | deployed |  |
| [Custom detail page button, URL](https://help.salesforce.com/s/articleView?id=platform.custom_button_link_limitations.htm&type=5) | [ ] | deployed |  |
| [Custom detail page link, URL](https://help.salesforce.com/s/articleView?id=platform.custom_button_link_limitations.htm&type=5) | [ ] | deployed |  |
| [Custom button that calls JavaScript (Help: not supported in Lightning Experience)](https://help.salesforce.com/s/articleView?id=platform.custom_button_link_limitations.htm&type=5) | [ ] | limitation | row says Help: not supported in Lightning Experience |
| [Custom Visualforce button](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [Custom list button on a list view](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [Mass quick action on a list view (Create or Update, up to 100 records)](https://help.salesforce.com/s/articleView?id=platform.mass_quick_actions.htm&type=5) | [x] | deployed |  |
| [Mass quick action on a related list](https://help.salesforce.com/s/articleView?id=platform.mass_quick_actions_related_lists.htm&type=5) | [x] | deployed |  |
| [Related list actions: custom list button, quick action, standard button](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [Action overflow menu in the highlights panel](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | in fixture |  |

## Dynamic Actions

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Dynamic Actions on a custom object record page](https://help.salesforce.com/s/articleView?id=platform.lightning_app_builder_create_dynamic_action.htm&type=5) | [ ] | in fixture |  |
| [Dynamic Actions on a standard object record page (desktop)](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [Dynamic action with a visibility filter on a record field](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components_visibility.htm&type=5) | [ ] | in fixture |  |
| [Dynamic action with a visibility filter on an advanced field (related object or User)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components_visibility.htm&type=5) | [x] | deployed |  |
| [Dynamic action with a visibility filter on a user permission or device](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components_visibility.htm&type=5) | [x] | deployed |  |
| [LWC action added through Dynamic Actions](https://help.salesforce.com/s/articleView?id=platform.lightning_web_component_actions.htm&type=5) | [x] | deployed |  |

## global action

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Global Actions menu in the header](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | in fixture |  |
| [Global publisher layout (Salesforce Mobile and Lightning Experience Actions section)](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |

## where an action sits

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Activity tab composer: New Task, New Event, Log a Call, Send Email](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |
| [Chatter tab publisher: standard Chatter actions](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [ ] | deployed |  |
| [Home page Assistant actions: New Task, New Event, Edit, Email](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |

## standard navigation app

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Standard navigation app: navigation bar, first item is the landing page](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_create.htm&type=5) | [ ] | in fixture |  |
| [Nav item: standard object tab](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [x] | deployed |  |
| [Nav item: custom object tab](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [x] | in fixture |  |
| [Nav item: Lightning page tab](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [ ] | in fixture |  |
| [Nav item: Lightning component tab (LWC or Aura)](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [ ] | deployed |  |
| [Nav item: Visualforce tab](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [x] | in fixture |  |
| [Nav item: web tab](https://help.salesforce.com/s/articleView?id=platform.customize_lex_nav_menus_create.htm&type=5) | [x] | deployed |  |
| [Nav bar More overflow menu](https://help.salesforce.com/s/articleView?id=xcloud.user_alltabs.htm&type=5) | [ ] | deployed |  |
| [Object tab dropdown: recent records, recent lists, top favorites, New](https://help.salesforce.com/s/articleView?id=xcloud.recent_items.htm&type=5) | [x] | in fixture |  |
| [App Launcher: search apps and items, View All, switch app](https://help.salesforce.com/s/articleView?id=xcloud.basics_app_launcher_lex.htm&type=5) | [x] | in fixture |  |
| [Personalized nav bar: add, reorder, rename, remove an item](https://help.salesforce.com/s/articleView?id=xcloud.user_userdisplay_tabs_lex.htm&type=5) | [ ] | in fixture |  |
| [Temporary tab in the nav bar (asterisk), Add to Nav Bar, Open in New Tab](https://help.salesforce.com/s/articleView?id=xcloud.user_userdisplay_tabs_lex.htm&type=5) | [ ] | in fixture |  |
| [Favorites star and favorites list](https://help.salesforce.com/s/articleView?id=xcloud.user_userdisplay_favorites.htm&type=5) | [ ] | in fixture |  |
| [Global search box: typeahead, recent searches, results page](https://help.salesforce.com/s/articleView?id=xcloud.basics_search_records_lex.htm&type=5) | [ ] | in fixture |  |
| [Notifications bell (page not fetched)](https://help.salesforce.com/s/articleView?id=xcloud.user_alltabs.htm&type=5) | [ ] | in fixture |  |
| [Vertical navigation bar (needs: Sales or Service Cloud, Enterprise and up; an org setting)](https://help.salesforce.com/s/articleView?id=xcloud.user_userdisplay_vertical_nav.htm&type=5) | [ ] | limitation | row says needs Sales or Service Cloud, Enterprise and up, and an org setting; scratch def features is empty |

## console navigation app

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Console app: workspace tabs](https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5) | [ ] | in fixture |  |
| [Console app: subtabs](https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5) | [ ] | in fixture |  |
| [Console app: navigation item menu (object dropdown), personalize it](https://help.salesforce.com/s/articleView?id=service.console_lex_personalize_nav.htm&type=5) | [ ] | in fixture |  |
| [Console app: split view panel](https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5) | [ ] | in fixture |  |
| [Console tab menu: refresh, pin, customize, close](https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5) | [ ] | in fixture |  |
| [Console: Ctrl or Cmd click opens a new workspace tab](https://help.salesforce.com/s/articleView?id=service.console_lex_intro.htm&type=5) | [ ] | in fixture |  |
| [Console navigation rule: record opens as a workspace tab](https://help.salesforce.com/s/articleView?id=service.console_lex_create_custom.htm&type=5) | [ ] | in fixture |  |
| [Console navigation rule: record opens as a subtab of a related record](https://help.salesforce.com/s/articleView?id=service.console_lex_create_custom.htm&type=5) | [ ] | deployed |  |
| [Console: inactive workspace pages load deferred](https://help.salesforce.com/s/articleView?id=service.console_lex_defer_loading_inactive_pages.htm&type=5) | [ ] | in fixture |  |
| [Console record page on a pinned region template (names verified: Pinned Header; Pinned Header and Left Sidebar; Pinned Left Sidebar; Pinned Left and Right Sidebars; Pinned Right Sidebar, 3 regions; Three Regions) see the A1 template rows](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_pages.htm&type=5) | [x] | deployed |  |

## utility bar

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Utility bar in a standard navigation app](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | in fixture |  |
| [Utility bar in a console app](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility panel: open, minimise, pop out](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [x] | in fixture |  |
| [Background utility item](https://developer.salesforce.com/docs/platform/aura-platform/guide/sforce-api-console-js-lightning-background-utility-item.md) | [ ] | deployed |  |
| [Utility bar alignment Mirrored](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: History (console apps only)](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_utilities_history.htm&type=5) | [ ] | deployed |  |
| [Utility item: Notes](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: Recent Items](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: Macros (no pop-out)](https://help.salesforce.com/s/articleView?id=service.macros_utility.htm&type=5) | [ ] | deployed |  |
| [Utility item: Omni-Channel (needs: Lightning Service Console, Omni-Channel)](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_utilities_omnichannel.htm&type=5) | [ ] | limitation | needs Lightning Service Console and Omni-Channel, scratch def features is empty |
| [Utility item: Softphone, Open CTI (needs: a call center)](https://help.salesforce.com/s/articleView?id=service.console_lex_custom_utilities_softphone.htm&type=5) | [ ] | deployed |  |
| [Utility item: Flow (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: List View (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: Rich Text (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: Report Chart (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | deployed |  |
| [Utility item: Quip (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [x] | deployed |  |
| [Utility item: custom LWC](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | in fixture |  |
| [Utility item: Visualforce (Help: not supported)](https://help.salesforce.com/s/articleView?id=platform.apps_lightning_utilities.htm&type=5) | [ ] | limitation | row says Help: not supported (Visualforce utility item) |

## related list form

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Related list display type Basic List](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | deployed |  |
| [Related list display type Enhanced List (resize, sort, wrap text, mass action checkboxes)](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [x] | in fixture |  |
| [Related list display type Tile](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | deployed |  |
| [Dynamic Related List - Single with filters and a sort order](https://help.salesforce.com/s/articleView?id=platform.lightning_app_builder_create_dynamic_related_list.htm&type=5) | [ ] | deployed |  |
| [Related list View All page](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&type=5) | [x] | in fixture |  |
| [Related list row actions: Edit, Delete](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&type=5) | [x] | in fixture |  |
| [Related list New button](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&type=5) | [x] | in fixture |  |
| [Related list with more records than the card shows (count 6+, View All)](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&type=5) | [ ] | deployed |  |
| [Inline edit on a related list View All page (not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | in fixture |  |
| [Related Record component: inline edit, create, link and unlink](https://help.salesforce.com/s/articleView?id=platform.lightning_page_components.htm&type=5) | [ ] | deployed |  |
| [Files related list (upload, Add Files)](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | deployed |  |
| [Notes & Attachments related list](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | deployed |  |
| [Notes related list (enhanced notes)](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | deployed |  |
| [Activity timeline: upcoming and overdue, past activity, filters, expand an item](https://help.salesforce.com/s/articleView?id=sales.activity_timeline_parent.htm&type=5) | [ ] | deployed |  |

## list view form

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [List view: table view](https://help.salesforce.com/s/articleView?id=xcloud.basics_navigate_list_views.htm&type=5) | [ ] | in fixture |  |
| [List view: Kanban view](https://help.salesforce.com/s/articleView?id=xcloud.kanban.htm&type=5) | [ ] | in fixture |  |
| [List view: split view in a standard navigation app](https://help.salesforce.com/s/articleView?id=xcloud.basics_navigate_list_views.htm&type=5) | [ ] | in fixture |  |
| [List view picker: search lists, pin a list, recent lists](https://help.salesforce.com/s/articleView?id=xcloud.basics_pinned_list_views_lex.htm&type=5) | [x] | in fixture |  |
| [List View Controls: New, Clone, Rename, Sharing Settings, Select Fields to Display, Delete, Reset Column Widths](https://help.salesforce.com/s/articleView?id=xcloud.customviews_lex.htm&type=5) | [ ] | in fixture |  |
| [List view filters panel: owner scope, field filters, filter logic](https://help.salesforce.com/s/articleView?id=xcloud.customviews_edit_filters_lex.htm&type=5) | [ ] | in fixture |  |
| [List view search box](https://help.salesforce.com/s/articleView?id=xcloud.basics_search_list_views_lex.htm&type=5) | [ ] | in fixture |  |
| [List view column sort (up to 5 columns)](https://help.salesforce.com/s/articleView?id=xcloud.basics_sorting_list_views.htm&type=5) | [ ] | in fixture |  |
| [List view column resize, wrap or clip text](https://help.salesforce.com/s/articleView?id=xcloud.basics_navigate_list_views.htm&type=5) | [x] | in fixture |  |
| [List view inline edit of one cell](https://help.salesforce.com/s/articleView?id=xcloud.customviews_edit_inline_listview_lex.htm&type=5) | [ ] | in fixture |  |
| [List view mass inline edit of the selected rows](https://help.salesforce.com/s/articleView?id=xcloud.basics_customviews_lv_lex_considerations.htm&type=5) | [ ] | in fixture |  |
| [List view inline edit of a picklist cell](https://help.salesforce.com/s/articleView?id=xcloud.customviews_edit_inline_listview_lex.htm&type=5) | [ ] | in fixture |  |
| [List view with more than one record type: inline edit locked](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | deployed |  |
| [List view row selection and mass action Change Owner](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_considerations.htm&type=5) | [ ] | in fixture |  |
| [List view row action menu: Edit, Delete, Change Owner](https://help.salesforce.com/s/articleView?id=xcloud.basics_navigate_list_views.htm&type=5) | [ ] | in fixture |  |
| [List view chart](https://help.salesforce.com/s/articleView?id=xcloud.customviews_listview_chart_create_lex.htm&type=5) | [ ] | new |  |
| [List view Refresh button](https://help.salesforce.com/s/articleView?id=xcloud.basics_navigate_list_views.htm&type=5) | [ ] | in fixture |  |
| [List view Import button and Printable View](https://help.salesforce.com/s/articleView?id=xcloud.basics_faq_which_records_print_listviews.htm&type=5) | [ ] | in fixture |  |
| [Recently Viewed list (default pinned list, no filters)](https://help.salesforce.com/s/articleView?id=xcloud.basics_pinned_list_views_lex.htm&type=5) | [x] | in fixture |  |
| [List view with more rows than the first load (scroll loads more; not named in the fetched docs)](https://help.salesforce.com/s/articleView?id=xcloud.basics_list_views_lex_best_practices.htm&type=5) | [ ] | deployed |  |

## Kanban

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Kanban settings: Group By, Summarize By](https://help.salesforce.com/s/articleView?id=xcloud.kanban_configuration.htm&type=5) | [ ] | in fixture |  |
| [Kanban: drag a card to another column](https://help.salesforce.com/s/articleView?id=xcloud.kanban_use.htm&type=5) | [ ] | in fixture |  |
| [Kanban: record type tabs](https://help.salesforce.com/s/articleView?id=xcloud.kanban_use.htm&type=5) | [ ] | deployed |  |
| [Kanban: details panel with inline edit of key fields](https://help.salesforce.com/s/articleView?id=xcloud.kanban_use.htm&type=5) | [ ] | in fixture |  |
| [Kanban: search and filters](https://help.salesforce.com/s/articleView?id=xcloud.kanban_use.htm&type=5) | [ ] | in fixture |  |

## from the slice 1 builder

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Path on Opportunity: Select Closed Stage dialog (a custom-object path has none; admin only, a platform user has no Opportunity access)](https://help.salesforce.com/s/articleView?id=sales.path_create.htm&type=5) | [x] | deployed |  |
| [Related list with a custom list button and a quick action (slice 1 built only the standard New button for A4-038)](https://help.salesforce.com/s/articleView?id=platform.actions_in_lex.htm&type=5) | [x] | deployed |  |

## lightning ui: App Builder component

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Action Launcher | [ ] | deployed |  |
| Add Risk Scenario Modal | [x] | deployed |  |
| AI Relationship Research | [ ] | limitation | shows nothing: needs Industries AI Relationship Research (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13; also offered on the Record palette of Account, Contact, Lead, Opportunity; refused on an Account record page: "The component 'AI Relationship Research' is invalid" (required Configuration Name offers no option), name read from App Builder on a scratch org, 2026-11-14 |
| Analytics | [ ] | limitation | shows an empty tab list: needs DevOps Center (read from the API name; this is DevOps Center analytics, not CRM Analytics, see A1-012 to A1-014); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Analytics heading with an empty tab list; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| App Analytics | [ ] | limitation | needs the App Analytics app (Pipeline Inspection), which is not installed; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "App Analytics app is not installed or no dashboards are available yet."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Approval Trace | [ ] | limitation | shows nothing: needs Employee Service (ITSM) approvals (read from the API name); the other palette entry with this label, runtime_approvals:approvalTrace, shows content and has no row; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under the first entry; the second palette entry shows "Approval Work Items: There are no approval work items associated with this record."; earlier: name read from App Builder on a scratch org, 2026-11-13; the second palette entry with this label, runtime_approvals:approvalTrace, is on the same page |
| Approvals Pending Review | [x] | deployed |  |
| apromore:apromoreHost | [ ] | limitation | shows an empty frame: needs the Apromore process mining app (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; under it an empty iframe; earlier: page types: Home; placed with no properties, validate 0AfQL00000tyGOo0AM |
| Assessment List | [ ] | limitation | needs Public Sector Solutions assessments; the component shows an internal error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "We couldn't get the assessments because of an internal error. Ask your Salesforce admin for help."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| builder_omnistudio_common:osBuildPlanCopilotFeed | [ ] | limitation | needs an OmniStudio build plan from the OmniStudio agent (read from the API name); the component shows an error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Draft Component, version 1.0, "The build plan could not be displayed. Review the details before continuing."; earlier: page types: Record, Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| builder_omnistudio_common:osComponentDiscoveryCopilotFeed | [x] | deployed |  |
| builder_omnistudio_common:osComponentSummaryCopilotFeed | [x] | deployed |  |
| builder_omnistudio_common:osGeneratorCopilotFeed | [x] | deployed |  |
| Call Scoring | [ ] | limitation | shows nothing: needs Conversation Insights call coaching (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Campaign Marketplace | [ ] | limitation | needs a Campaign list view; App Builder refused it: "The component 'Campaign Marketplace' is invalid" ("List View Name" offers only "No filters available"); name read from App Builder on a scratch org, 2026-11-13 |
| Campaign Tasks | [ ] | limitation | shows nothing: needs Marketing planning (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Cdp Educational Guidance | [ ] | limitation | shows nothing: needs Data Cloud (read from the API name; a Setup guidance component); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Consumption Analytics Metric | [ ] | limitation | shows nothing: needs Digital Wallet (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| CSI Predictive Scores | [ ] | limitation | needs the CSI Score app (cross cloud predictive scores); the card shows, then an app-not-found message; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Top Drivers card with a Score picker; admin "No feature importance data available.", Probe Breaker "CSI Score app not found"; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Data Mask Console Home Component | [ ] | deployed |  |
| Data Mask Jobs Access Denied | [ ] | limitation | needs a sandbox: Data Mask jobs run in sandbox orgs only; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "Jobs aren't available in this org. Data Mask jobs run in sandbox orgs only."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Digital Wallet Home Banner | [ ] | limitation | shows nothing: needs Digital Wallet (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| edulearning:programPlanBuilderComplexRequirementsApp | [ ] | limitation | shows nothing: needs Education Cloud program plans (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: Record, Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| enterprise_ai_harness:enterpriseAiHarnessHost | [ ] | limitation | shows an empty frame: needs the Enterprise AI harness (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; under it an empty iframe (read for Probe Breaker; the admin snapshot was cut before it); earlier: page types: Home; placed with no properties, validate 0AfQL00000tyGOo0AM |
| Event Definition Record Home | [x] | deployed |  |
| Event Definitions | [x] | deployed |  |
| Event Insights | [ ] | deployed |  |
| Flow App Home cards | [ ] | deployed |  |
| fsc_householding_industries:createNewHouseholdModalWrapper | [ ] | limitation | needs Financial Services Cloud Households; a permission notice for the break-run user, nothing for the admin; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: nothing; Probe Breaker: New Household heading and the notice "Can't create household. ... you don't have the required permissions to access the Households feature."; earlier: page types: Record, Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| fsc_referral_mgmt:assignmentRulesContainer | [x] | deployed |  |
| fsc_referral_mgmt:assignmentRulesManager | [x] | deployed |  |
| fsc_referral_mgmt:referralFormSetupContainer | [x] | deployed |  |
| fsc_referral_mgmt:referralReceiverExperienceContainer | [x] | deployed |  |
| Generate Batch Documents | [ ] | limitation | shows nothing: needs Nonprofit Cloud gift acknowledgements (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Generic Knowledge Creation | [ ] | deployed |  |
| Hierarchical Gantt Wrapper (Common) | [ ] | limitation | shows nothing: needs Marketing planning (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Home MRU Tabs | [ ] | limitation | needs OmniStudio records; the component shows an access error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; tabs OmniScripts, FlexCards, Integration Procedures, Data Mappers with an empty grid; "Error loading records: You don't have access to this record."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| ime_mrm:eventConsoleWrap | [ ] | limitation | needs Event Management (Industries) data; the panels show load errors; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; an Event Console with its navigation and "Participant numbers couldn't be loaded.", "Confirmations couldn't be loaded.", "Expense categories couldn't be loaded."; the record was opened by its URL (the object has no list view; Recently Viewed was empty); earlier: page types: Record; placed with no properties, validate 0AfQL00000tyGOo0AM |
| In-Progress Work | [ ] | limitation | needs Omni-Channel (supervisor); the component shows Offline and an error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Active Work Items with "You're offline. Click the refresh icon to reconnect."; admin: "Loading"; Probe Breaker: "Something went wrong. Try refreshing or come back later."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| industries_document_checklist:qualityChecksSetup | [x] | deployed |  |
| industries_ls_commercial:mngEventPtcpRecordTypeMappingList | [x] | deployed |  |
| industries_mfg_rebates:byRebateTypeList | [x] | deployed |  |
| Inventory Lookup Component | [ ] | deployed |  |
| Invoice Preview | [ ] | deployed |  |
| IT Leader Dashboard List | [ ] | limitation | needs ITSM dashboards; the component shows a permission message; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "You don't have permission to access this dashboard."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| ITAM Asset Analytics Dashboard | [ ] | limitation | needs IT Asset Management dashboards; the component shows a permission message; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "You don't have permission to access this dashboard. Contact your administrator to request access."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| ITSM Intelligence Hub | [ ] | limitation | needs ITSM Intelligence Hub dashboards, which are not set up; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; alert "Your ITSM Intelligence Hub dashboards are in the works. Come back soon ..."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| kpi_explorer:kpiExplorerApp | [x] | deployed |  |
| kpi_explorer:kpiExplorerSetupPage | [x] | deployed |  |
| kpi_explorer:rcaModel | [x] | deployed |  |
| Leads to Review | [ ] | limitation | needs a Lead list view; App Builder refused it: "The component 'Leads to Review' is invalid" ("Leads List Views" offers only "No filters available"); name read from App Builder on a scratch org, 2026-11-13 |
| Life Sciences Next Best Customers | [ ] | deployed |  |
| Live Card | [ ] | limitation | needs a Live Card selected in its properties (Industries Live Card); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "No Live Card selected - Select a Live Card to load the card and its contents."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Location Management Component | [ ] | limitation | needs Omnichannel Inventory (Commerce); stays on Loading for the admin, shows nothing for the break-run user; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: Location Management Changes card on "Loading location management data" and two list tables; Probe Breaker: nothing; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Location Preference Launcher | [x] | deployed |  |
| Marketing Tactic List View | [ ] | deployed |  |
| My Labels | [ ] | deployed |  |
| New Order | [ ] | limitation | needs an Industries Manufacturing order setup; its New Order modal shows a configuration error; on the page (render on sfui-s4-cascade, 2026-11-14): label in the page, both users, covered by its own modal: the component opens a "New Order" modal on page load (Order Specification disabled: "This field can't load because of a configuration problem."; Save disabled); earlier: name read from App Builder on a scratch org, 2026-11-13; renders a modal over the whole canvas in App Builder, so it shares its page with one other component only; also offered on the Record palette of Account, Contact, name read from App Builder on a scratch org, 2026-11-14 |
| omni_supervisor:backlog | [ ] | limitation | needs Omni-Channel (supervisor); the component shows Offline and an error, see A1-064 and A2-036; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Work Backlog with an Offline bar and a Reconnect button; admin: "Loading"; Probe Breaker: "Something went wrong. Try refreshing or come back later."; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| omni_supervisor:serviceReps | [ ] | limitation | needs Omni-Channel (supervisor); the component shows Offline and an error, see A1-064 and A2-036; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Service Reps Overview with an Offline bar; admin: "Loading"; Probe Breaker: "Something went wrong. Try refreshing or come back later."; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| OmniStudio Home | [ ] | limitation | needs OmniStudio usage data; the home shows load errors; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Welcome to Omnistudio with tabs Trends and Component Health; alerts "Unable to load consumption data." and "Unable to load generation trend data."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Outbound Engagement | [ ] | limitation | needs an Outbound Engagement template; App Builder refused it: "The 'Outbound Engagement' component's 'Outbound Engagement Templates' property has an invalid value." (builder name runtime_ime_distribution:distributionComponentWrapper); name read from App Builder on a scratch org, 2026-11-13 |
| Outbound Engagement Bulk Launcher | [ ] | limitation | shows nothing: needs Outbound Engagement (Industries distribution, read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Outbound Engagement Launcher | [ ] | limitation | shows nothing: needs Outbound Engagement (Industries distribution, read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Parent Record Details | [ ] | limitation | needs a Service Appointment record (Field Service dispatch console); on this object it shows a query error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; error text: the "fields" query string parameter names ServiceAppointment while the record is an SfUiC_Pal__c (the component wants a Service Appointment record); earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Parent Record Related Lists | [ ] | limitation | needs a Service Appointment record (Field Service dispatch console); on this object it shows a query error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; the same error text as A1-157 (the component wants a Service Appointment record); earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Paused Flow Interviews | [ ] | deployed |  |
| Policy Center Console Home Component | [ ] | limitation | needs Policy Center (data governance); the break-run user sees a no-access message, the admin nothing; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: nothing; Probe Breaker: "Feature not available - You don't have access to Policy Center."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Quip Associated Documents | [ ] | limitation | needs Quip, see A1-033; the component shows a setup message; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: Associated Documents, "This component requires additional setup."; Probe Breaker: "Quip Lightning components don't support logging in as another user in Salesforce."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Quip Notifications | [ ] | limitation | needs Quip, see A1-033 and A2-042; the component shows a setup message; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: "This component requires additional setup."; Probe Breaker: "Quip Lightning components don't support logging in as another user in Salesforce."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Recent Records | [ ] | deployed |  |
| Record Detail - Mobile | [ ] | limitation | a mobile-only component: shows nothing on a desktop page; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it (a mobile component on a desktop page); earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Request Approval | [ ] | deployed |  |
| Risk Scenario Home Page | [x] | deployed |  |
| Risk Scenario Library Header | [x] | deployed |  |
| runtime_cdp:agenticActivationConfirmCard | [ ] | limitation | shows nothing: needs Data Cloud segment activation (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: Record, Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_cdp:agenticActivationCreatedCard | [ ] | limitation | shows nothing: needs Data Cloud segment activation (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: Record, Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_cdp:agenticActivationListPicker | [x] | deployed |  |
| runtime_cdp:limitedAccessBadge | [x] | deployed |  |
| runtime_cdp:marketSegmentActivationMatchCount | [ ] | limitation | shows nothing: needs Data Cloud segment activation (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_cdp:quickAttributeDeleteModal | [ ] | deployed |  |
| runtime_commerce_oci:tenantInfoDashboard | [ ] | limitation | needs an Omnichannel Inventory tenant (Commerce); the admin sees a load error, the break-run user a blank panel; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: error toast "Oops an error occurred Unable to load tenant info. Please try again."; Probe Breaker: Omnichannel Network panel, Total Locations blank, "Never updated"; earlier: page types: Home; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_hcc_trust360:trust360 | [ ] | limitation | needs Health Insights; the break-run user sees an initialisation error, the admin nothing; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; admin: nothing; Probe Breaker: error box "We couldn't initialize Health Insights. Refresh the page."; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_hcc_trust360:trust360Adoption | [x] | deployed |  |
| runtime_hcc_trust360:trust360AgentPanel | [ ] | limitation | needs the Health Assessments Agent (Agentforce), which is not enabled; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "The Health Assessments Agent isn't enabled for this org yet. ..."; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_hcc_trust360:trust360AppShell | [ ] | limitation | needs Health Insights data and Agentforce; its chat dialog shows an error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "No health data yet. Run a scan ..." and an Agentforce for Health chat dialog (admin: "Loading..."; Probe Breaker: "Something went wrong. Refresh and try again."); the tab's URL moves to the Health Insights app home; earlier: page types: Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_hcc_trust360:trust360Home | [x] | deployed |  |
| runtime_hcc_trust360:trust360ImplementationHealth | [x] | deployed |  |
| runtime_hcc_trust360:trust360Nav | [x] | deployed |  |
| runtime_industries_commandcenter:ccSettingsPage | [x] | deployed |  |
| runtime_industries_commandcenter:commandCenterNav | [x] | deployed |  |
| runtime_industries_commandcenter:watchListToolbar | [x] | deployed |  |
| runtime_industries_sustainability:supplierAllScorecardList | [x] | deployed |  |
| runtime_industries_sustainability:supplierOpenScorecardList | [x] | deployed |  |
| runtime_omnistudio:componentConsumptionRate | [x] | deployed |  |
| runtime_omnistudio:componentConsumptionRateContainer | [ ] | limitation | needs OmniStudio usage data; the component shows a load error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; alert "Unable to load consumption data. Try refreshing the page."; earlier: page types: Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_omnistudio:generationTrend | [ ] | deployed |  |
| runtime_omnistudio:generationTrendContainer | [x] | deployed |  |
| runtime_omnistudio:homeTrends | [x] | deployed |  |
| runtime_pipeline_inspector:salesInsights | [ ] | limitation | needs the Sales Insights app, which is not installed; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "Sales Insights app is not installed or no dashboards are available."; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_revenue_account:billingForecastWrapper | [ ] | limitation | needs Revenue Cloud billing data; the tiles stay on Loading; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Billing Forecast with filters and three metric tiles that stay on "Loading"; the record was opened by its URL; earlier: page types: Record; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_revenue_studio:revenueStudioDashboardPlaceholder | [x] | deployed |  |
| runtime_revenue_studio:revenueStudioNav | [x] | deployed |  |
| runtime_sales_cadencebuilder:createEditCadenceLite | [ ] | limitation | shows nothing: needs Sales Engagement cadences (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: Home, App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_sales_campaign:guidedLeadCaptureFormSetup | [x] | deployed |  |
| runtime_sales_campaign:listSendsView | [ ] | limitation | needs Marketing list sends; the component shows a load error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; All List Sends, 0 items; alert "Something went wrong - We couldn't load your list sends. Try again." with a Retry button; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_service_itam:fulfillmentOrderReceiveAction | [ ] | limitation | shows nothing: needs IT Asset Management fulfilment orders (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; the record was opened by its URL; earlier: page types: Record; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_service_itam:fulfillmentOrderSentAction | [ ] | limitation | shows nothing: needs IT Asset Management fulfilment orders (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; the record was opened by its URL; earlier: page types: Record; placed with no properties, validate 0AfQL00000tyGOo0AM |
| runtime_service_itam:itemsReadyForShipmentAction | [ ] | limitation | shows nothing: needs IT Asset Management fulfilment orders (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; the record was opened by its URL; earlier: page types: Record; placed with no properties, validate 0AfQL00000tyGOo0AM |
| Sales Plan Overview | [ ] | deployed |  |
| sales_einstein_sdr:createEnsembleDataRetrieverModal | [x] | deployed |  |
| sales_einstein_sdr:createWebCrawlerConnectorModal | [x] | deployed |  |
| sales_einstein_sdr:dataGraphCreationModal | [x] | deployed |  |
| sales_einstein_sdr:sellerWorkModeContainer | [ ] | limitation | shows nothing: needs Agentforce Sales Development (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| sales_einstein_sdr:webConnectorPersonalizationModal | [x] | deployed |  |
| Salesforce Anywhere Messages | [ ] | limitation | shows nothing: needs Salesforce Anywhere (Quip, read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| setup_agent_health_monitoring:agentAlerts | [ ] | limitation | needs agent health alerts set up (Agentforce; a Setup component); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "Alerts haven't been set up." with a link "configuration requirements"; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| setup_agent_health_monitoring:alertDetails | [x] | deployed |  |
| setup_agent_health_monitoring:heartbeatDetails | [ ] | limitation | shows nothing: needs Agentforce agent health monitoring (a Setup component); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: page types: App; placed with no properties, validate 0AfQL00000tyGOo0AM |
| setup_marketing_unifiedmarketing:customFontsBusinessUnitSection | [x] | deployed |  |
| Slack | [ ] | limitation | needs a Slack connection; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "Slack isn't connected - There's an issue with the connection between Salesforce and Slack."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Tableau Pulse | [ ] | limitation | needs Tableau with seamless authentication; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; "To enable Tableau Pulse LWC, please reach out to your Salesforce admin to configure seamless authentication for Tableau."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Tableau View | [ ] | limitation | shows an empty frame: needs a Tableau site and view; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; under it an empty iframe; earlier: name read from App Builder on a scratch org, 2026-11-13; vizUrl is a public Tableau view, copied from the hand page |
| Top Used Cards | [ ] | limitation | shows nothing: needs Digital Wallet (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Top Used Licenses | [ ] | limitation | shows nothing: needs Digital Wallet (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Top Used Product Limits | [ ] | limitation | shows nothing: needs Digital Wallet (read from the API name); on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; nothing under it; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Trade Calendar | [x] | deployed |  |
| URL Slugs | [ ] | deployed |  |
| Work Skill Group | [ ] | limitation | needs Workforce Engagement skills; the card shows a load error; on the page (render on sfui-s4-cascade, 2026-11-14): label shown, both users; Work Skill Group card and Associated Skills with the alert "Unable to load associated skills."; earlier: name read from App Builder on a scratch org, 2026-11-13 |
| Account Summary | [ ] | deployed |  |
| Account Utilization Limits | [ ] | deployed |  |
| Company Hierarchy | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account, Opportunity; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Data.com Insights | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account, Opportunity; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Managed Asset Viewer | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Offline Assessment Details | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Offline Assessment Selection | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Scoring | [ ] | limitation | stays on "Loading Scores..." on a plain org (render check 2026-11-14); page types: Record; offered on Account, Contact, Lead; name read from App Builder on a scratch org, 2026-11-14; builder preview stays on "Loading Scores..." |
| Transaction Line Editor | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Account; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Insufficient permissions" |
| Customer Insights | [ ] | limitation | shows nothing under its label on a plain org (render check 2026-11-14); page types: Record; offered on Contact, Case; name read from App Builder on a scratch org, 2026-11-14; the API name console:lastViewedInCommunity does not match the label; builder preview: "Insufficient permissions" |
| Messaging Subscriber Card | [ ] | deployed |  |
| Milestones | [ ] | deployed |  |
| Social Conversations | [ ] | limitation | needs a case with a social origin; on the page: "Social conversations are not supported for the selected case origin." (render check 2026-11-14); opens for the admin only: the break-run user's licence has no Case access; ; page types: Record; offered on Case; name read from App Builder on a scratch org, 2026-11-14; builder preview: "Social conversations are not supported for the selected case origin." |

## lightning ui: page template

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Record: Grouped Header and One Region | [ ] | deployed |  |
| Record: Header and One Region | [ ] | deployed |  |
| Record: Pinned Header and Left Sidebar (2 regions) | [ ] | deployed |  |
| Record: Printable View | [ ] | deployed |  |
| Record: Three Regions | [ ] | deployed |  |
| Home: Devops Center Home Page | [ ] | new |  |
| Home: Header and Right Sidebar | [ ] | new |  |
| Home: Home Template One Region | [ ] | new |  |
| Home: Lightning Home flexipage template for desktop form factor | [ ] | new |  |
| Home: Omnichannel Inventory Home Template One Region | [ ] | new |  |
| Home: Privacy Center Home Template One Region | [ ] | new |  |
| Home: Seller Home | [ ] | new |  |
| Home: (blank name) | [ ] | new |  |
| App: Header and Left Sidebar with 15% width | [x] | deployed |  |
| App: Header and Two Regions | [x] | deployed |  |
| App: Three Regions | [ ] | deployed |  |

## lightning ui: analytics page

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Report run page: filters panel, chart, grouping, drill into a row](https://help.salesforce.com/s/articleView?id=xcloud.basics_reports_running_a_report.htm&type=5) | [x] | deployed |  |
| [Dashboard page: refresh, dashboard filter, open a source report](https://help.salesforce.com/s/articleView?id=analytics.dashboard_filters_using.htm&type=5) | [x] | deployed |  |

## lightning ui: standard dialog

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Convert Lead dialog](https://help.salesforce.com/s/articleView?id=sales.leads_convert.htm&type=5) | [x] | deployed |  |
| [Merge duplicate records: pick records, pick field values](https://help.salesforce.com/s/articleView?id=sales.leads_merge_lex.htm&type=5) | [x] | deployed |  |
| [Add Products and Edit Selected Products on an opportunity (editable grid in a modal)](https://help.salesforce.com/s/articleView?id=sales.products_add.htm&type=5) | [ ] | deployed |  |
| [Send List Email from a list view](https://help.salesforce.com/s/articleView?id=sales.email_list_email.htm&type=5) | [x] | deployed |  |

## lightning ui: standard page

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Calendar: day, week and month views, new event from a time slot | [x] | deployed |  |
| [Recycle Bin: view and restore](https://help.salesforce.com/s/articleView?id=xcloud.recycle_bin_use.htm&type=5) | [x] | deployed |  |
| [Account Hierarchy page (tree grid)](https://help.salesforce.com/s/articleView?id=sales.account_hierarchy_setup_lex.htm&type=5) | [ ] | new |  |
| Files home and the file preview player | [x] | deployed |  |

## lightning ui: button override

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Standard button override with an LWC (New or Edit opens a custom component)](https://help.salesforce.com/s/articleView?id=platform.links_customize_override.htm&type=5) | [ ] | limitation | a standard button cannot be overridden by an LWC, only by an Aura component that implements lightning:actionOverride (Help, links_override_considerations: "When overriding tabs or buttons with a Lightning component, you can select only Lightning components that implement the lightning:actionOverride interface."); tried on 2026-11-14 as the New override of SfUiC_Ovr__c, validate 0AfQL00000tzZ620AE: "sfUiCOvrNew does not exist or is not a valid override for action New."; the Aura override is A7-122 |
| [Standard button override with a Visualforce page](https://help.salesforce.com/s/articleView?id=platform.links_customize_override.htm&type=5) | [ ] | deployed |  |

## lightning ui: org setting

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Display density: Comfy against Compact (label above or beside the field) | [ ] | new |  |
| [State and Country/Territory Picklists (the address becomes two picklists)](https://help.salesforce.com/s/articleView?id=xcloud.state_country_and_territory_picklist_fields.htm&type=5) | [ ] | new |  |
| [Person Accounts (an Account with a compound Name and Contact fields)](https://help.salesforce.com/s/articleView?id=sales.account_person.htm&type=5) | [ ] | new |  |
| [Multiple currencies (currency picker on the record, converted amount in brackets)](https://help.salesforce.com/s/articleView?id=sales.admin_currency.htm&type=5) | [ ] | new |  |

## lightning ui: form feature

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Save options on Case, Lead and Account edit forms (assignment rule checkbox)](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | new |  |
| [Cross-object fields in a Dynamic Forms field section](https://help.salesforce.com/s/articleView?id=platform.dynamic_forms_spanning_fields.htm&type=5) | [ ] | deployed |  |
| [Quick Text insert](https://help.salesforce.com/s/articleView?id=service.quick_text_insert.htm&type=5) | [ ] | deployed |  |

## lightning ui: Agentforce

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Agentforce panel for internal users](https://help.salesforce.com/s/articleView?id=sales.einstein_copilot_for_sales.htm&type=5) | [ ] | limitation | needs an Agentforce or Einstein add-on; the closest page gives the gate for the sales actions: "Available in: Enterprise, Performance, and Unlimited Editions with the Einstein for Sales add-on"; unverified: no doc page found (2026-11-14) for the panel itself |
| [Agent Quick Action (a quick action that starts an agent)](https://help.salesforce.com/s/articleView?id=platform.agent_quick_actions.htm&type=5) | [ ] | limitation | needs an Agentforce or Einstein add-on; page title read from the Help table of contents, body not read |
| [Prompt Builder field generation button on a record field](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_prompt_template_capability_example.htm&type=5) | [ ] | limitation | needs Prompt Builder; unverified: no doc page found (2026-11-14) for the button, the doc URL is the related Example of Field Generation Flow page |

## lightning ui: Experience Builder page type

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Experience Builder page type: CommAppPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommContractDetailViewPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommCheckoutPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommFlowPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommForgotPasswordPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommGlobalSearchResultPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommLoginPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommNoSearchResultsPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommObjectPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommOrderComfirmationPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture; spelled so in the doc |
| [Experience Builder page type: CommQuickActionCreatePage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommRecordPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommRelatedListPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommSearchResultPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommSelfRegisterPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| [Experience Builder page type: CommThemeLayoutPage](https://developer.salesforce.com/docs/platform/api-metadata/references/meta-types/metadata-flexipage) | [ ] | limitation | Experience Cloud, out of scope for this fixture |
| Experience Builder component palette (Aura and LWR templates; split into rows when Experience Cloud starts) | [ ] | limitation | Experience Cloud, out of scope for this fixture; unverified: no doc page found (2026-11-14), no palette list was read |

## lightning ui: Salesforce mobile app

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| [Phone form factor: mobile navigation, action bar, phone-only Lightning pages](https://help.salesforce.com/s/articleView?id=platform.dynamic_forms_mobile.htm&type=5) | [ ] | limitation | desktop scope: the fixture covers desktop Lightning Experience; also https://help.salesforce.com/s/articleView?id=platform.actionbar_how_actions_are_ordered.htm&type=5; mobile rows today: A4-023, A6-144 |

## lightning ui: licensed product

| Component | Can be tested | In the fixture | Note |
|---|---|---|---|
| Field Service dispatcher console | [ ] | limitation | needs a Field Service licence; unverified: no doc page found (2026-11-14), the name is from memory |
| Salesforce CPQ quote line editor (a managed package page) | [ ] | limitation | needs the Salesforce CPQ managed package and licence; unverified: no doc page found (2026-11-14), the name is from memory |
| Lightning Knowledge sidebar and article page | [ ] | limitation | needs Lightning Knowledge; unverified: no doc page found (2026-11-14), the name is from memory |
