import LightningModal from 'lightning/modal';

// Fixture for the sf-ui combinations catalogue: the batch 1 component inside a LightningModal (no recordId, so no
// nested open button).
export default class SfUiMoreModal extends LightningModal {
    handleDone() {
        this.close();
    }
}
