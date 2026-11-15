import { LightningElement } from 'lwc';

export default class SfUiCBaseActions extends LightningElement {
    pressed = 'none';

    press(event) {
        this.pressed = event.target.label;
    }
}
