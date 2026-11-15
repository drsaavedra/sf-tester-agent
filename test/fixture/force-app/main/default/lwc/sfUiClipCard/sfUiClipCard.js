import { LightningElement } from 'lwc';

// A card whose details open below its button: the clipping fixture a tester verifies a fix on.
export default class SfUiClipCard extends LightningElement {
    shown = false;

    handleShow() {
        this.shown = true;
    }

    handleClose() {
        this.shown = false;
    }
}
