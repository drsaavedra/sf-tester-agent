import { LightningElement } from 'lwc';

export default class SfUiCBaseProgress extends LightningElement {
    percent = 40;
    step = '2';

    advance() {
        this.percent = this.percent >= 100 ? 0 : this.percent + 20;
    }

    pickStep(event) {
        this.step = event.target.value;
    }
}
