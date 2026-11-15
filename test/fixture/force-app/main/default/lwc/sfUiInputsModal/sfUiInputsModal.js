import LightningModal from 'lightning/modal';

// Fixture for the sf-ui combinations catalogue: the inputs component inside a LightningModal (no recordId, so no
// nested open button).
export default class SfUiInputsModal extends LightningModal {
    handleDone() {
        this.close();
    }
}
