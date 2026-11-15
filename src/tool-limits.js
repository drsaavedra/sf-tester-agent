'use strict';

// What each sf_* tool can do to the org and the disk: a record for the reader, except localFile, which sets NOT_A_STEP.
// docs/tool-guidelines.md says how to class one; test/tool-limits.test.js fails on a tool with no class.
const CLASSES = {
  read: ['sf_whoami', 'sf_object_context', 'sf_toasts', 'sf_viewport', 'sf_modal', 'sf_apex', 'sf_page_errors', 'sf_page_snapshot', 'sf_map_feature', 'sf_route',
    'sf_combinations', 'sf_improvements', 'sf_cancel', 'sf_end', 'sf_set_fields'],
  // These open a record page or an object home, directly or to reach a component.
  readSideEffect: ['sf_actions', 'sf_open_record', 'sf_open_tab', 'sf_open_list', 'sf_open_related_list', 'sf_search', 'sf_form_model', 'sf_lwc_read', 'sf_verify_live', 'sf_assert_field',
    'sf_edit_record', 'sf_edit_inline', 'sf_create_record', 'sf_on_top', 'sf_hover', 'sf_measure', 'sf_wait', 'sf_watch'],
  login: ['sf_start', 'sf_login_as'],
  // sf_fill: a component that saves on change saves what it types.
  uiWrite: ['sf_save', 'sf_click', 'sf_press', 'sf_upload_file', 'sf_launch_action', 'sf_list', 'sf_fill'],
  // sf_verify_checks also runs a check-only validate as the persona: its Apex rolls back, the org keeps the deploy's status.
  apiRead: ['sf_api', 'sf_verify_checks'],
  runsTools: ['sf_run_route'],
  localFile: ['sf_screenshot', 'sf_scenario', 'sf_save_route', 'sf_promote_route', 'sf_record_improvement', 'sf_fix_improvement'],
};

// A route step skips the agent's tools line and its hooks, so a tool that writes a record of the run never is one;
// sf_verify_checks reads a local file, so agents/guard.js judges its steps in sf_run_route and sf_save_route.
const NOT_A_STEP = ['sf_start', 'sf_end', 'sf_run_route', ...CLASSES.localFile.filter((t) => t !== 'sf_screenshot')];

// What a scenario's route never holds: the tools that cannot be steps, the ones that change who or what a route is about, and
// the planners (sf_map_feature, sf_route) whose answer the agent acts on with steps of its own, so no replayed step reads it.
const NOT_CAPTURED = [...NOT_A_STEP, 'sf_login_as', 'sf_screenshot', 'sf_combinations', 'sf_improvements', 'sf_map_feature', 'sf_route'];

// The steps that land on a page by themselves, so a route can start with one; a route whose first step that is not a look
// opens no page is NO_ENTRY.
const ENTRY = ['sf_open_record', 'sf_open_tab', 'sf_open_list', 'sf_open_related_list', 'sf_search', 'sf_create_record', 'sf_edit_record'];

// These always reload the record page from a recordId (nav.openRecord), sf_assert_field not with via api; sf_lwc_read and
// sf_verify_live reuse an open page (lwc.js locate), so they are not entries.
const PAGE_OPENERS = ['sf_form_model', 'sf_assert_field', 'sf_actions'];

// Looks: steps that change nothing on the page or the session, so a route can leave out the ones before its page opens;
// sf_apex, sf_viewport and the form tools are classed read too, but a later step depends on them, so they are never dropped.
const LOOKS = ['sf_whoami', 'sf_object_context', 'sf_toasts', 'sf_page_errors', 'sf_page_snapshot', 'sf_api'];

module.exports = { CLASSES, NOT_A_STEP, NOT_CAPTURED, ENTRY, PAGE_OPENERS, LOOKS };
