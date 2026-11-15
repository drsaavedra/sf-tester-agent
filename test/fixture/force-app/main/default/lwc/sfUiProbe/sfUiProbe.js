import { LightningElement, api } from 'lwc';
import pingApex from '@salesforce/apex/SfUiProbeController.ping';
import SfUiProbeModal from 'c/sfUiProbeModal';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Fixture for the sf-ui tests: one of each thing the tools must reach (an Apex call, a modal, a row, an upload),
// plus layering targets (an in-component SLDS dialog), a nested child, and row icons only their column tells apart.
export default class SfUiProbe extends LightningElement {
    @api recordId;
    rows = [{ key: 'r1', name: 'row one' }, { key: 'r2', name: 'row two' }];
    pong;
    note;
    picked;
    edited;
    uploaded;
    inline = false;

    async handlePing() {
        this.pong = await pingApex({ recordId: this.recordId });
        this.dispatchEvent(new ShowToastEvent({ title: 'Ping', message: this.pong, variant: 'success' }));
    }

    async handleOpen() {
        this.note = await SfUiProbeModal.open({ size: 'small', label: 'SF UI Probe Dialog' });
    }

    handlePick(event) {
        this.picked = event.target.dataset.name;
    }

    handleEdit(event) {
        this.edited = event.currentTarget.dataset.name;
    }

    toggleInline() {
        this.inline = !this.inline;
    }

    handleUploaded(event) {
        this.uploaded = event.detail.files.map((f) => f.name).join(', ');
    }
}
