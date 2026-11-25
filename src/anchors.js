'use strict';

// Lightning tags sf-tester waits on or scopes by, cited to the salesforce-pageobjects@13.0.0 (Winter '27) page object
// naming each, else measured on the fixture org. Nothing ships from the package; on a red nightly, look or re-measure.
module.exports = Object.freeze({
  // records/highlights2.utam.json; Task and Event pages draw the Aura panel instead (measured on sfui-s4-flow)
  highlights: 'records-highlights2, [data-aura-class~="forceHighlightsPanel"]',
  pageError: 'flexipage-error', // in no page object; measured on the fixture org
  recordHome: 'one-record-home-flexipage2', // global/recordHomeTemplateDesktop.utam.json
  recordAction: 'one-record-action-flexipage', // the New dialog's page host; in no page object, measured on sfui-pool-3
  // records/lwcDetailPanel.utam.json; a Task page draws the Aura panel (measured on sfui-s4-flow)
  detailPanel: 'records-lwc-detail-panel, [data-aura-class~="forceDetailPanelDesktop"]',
  // in no page object; measured on sfui-s4-flow (inline edit, layout and Dynamic Forms; the Aura one on a Task page)
  formFooter: 'records-form-footer, [data-aura-class~="forceRecordEditActions"]',
  layoutItem: 'records-record-layout-item', // records/recordLayoutItem.utam.json
  lookup: 'force-lookup', // force/lookup.utam.json
  hoverableLink: 'records-hoverable-link', // force/lookup.utam.json
  helptext: 'lightning-helptext', // in no page object; measured on sfui-pool-2 (reads "Help <label>")
  generatedPagePrefix: 'forcegenerated-flexipage_', // in no page object; measured on the fixture org
});
