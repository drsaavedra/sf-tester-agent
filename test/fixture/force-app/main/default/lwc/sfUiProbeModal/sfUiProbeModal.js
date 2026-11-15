import LightningModal from 'lightning/modal';

// Fixture for the sf-ui tests: a modal with a text box and a footer button that returns what was typed.
export default class SfUiProbeModal extends LightningModal {
    value = '';
    fileName;

    handleNote(event) {
        this.value = event.target.value;
    }

    handleFile(event) {
        this.fileName = event.target.files[0].name;
    }

    handleDone() {
        this.close(this.value);
    }
}
