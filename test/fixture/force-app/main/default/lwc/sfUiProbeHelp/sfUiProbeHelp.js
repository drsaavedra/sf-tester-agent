import { LightningElement } from 'lwc';

// Fixture for the sf-ui tests: rendered inside sfUiProbe and never placed on a FlexiPage, so it is found through
// shadow roots; its info icon shows to assistive tech only as the text "Info", with no role.
export default class SfUiProbeHelp extends LightningElement {}
