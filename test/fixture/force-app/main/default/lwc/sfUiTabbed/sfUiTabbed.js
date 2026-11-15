import { LightningElement } from 'lwc';

// Fixture for the sf-ui tests: placed only in a non-default tab, so reaching it needs the tab path; its bare
// file input has no label, the case files.upload sets directly.
export default class SfUiTabbed extends LightningElement {
    fileName;

    handleFile(event) {
        this.fileName = event.target.files[0].name;
    }
}
