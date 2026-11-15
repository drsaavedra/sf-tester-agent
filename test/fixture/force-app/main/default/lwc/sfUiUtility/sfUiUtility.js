import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue: a panel in the SF UI App utility bar, echoing its input on a button.
export default class SfUiUtility extends LightningElement {
    note = '';
    pinged = false;

    handleNote(event) {
        this.note = event.detail.value;
    }

    handlePing() {
        this.pinged = true;
    }
}
