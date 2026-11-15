import { LightningElement, api } from 'lwc';

// Fixture for the sf-ui combinations catalogue: lightning-record-edit-form in a custom component, editing the
// record it sits on (number, dependent picklist, lookup) and echoing a successful save.
export default class SfUiRecordForm extends LightningElement {
    @api recordId;
    saved = false;

    handleSuccess() {
        this.saved = true;
    }
}
