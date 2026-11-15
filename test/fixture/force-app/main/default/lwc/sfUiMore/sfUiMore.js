import { LightningElement, api } from 'lwc';
import SfUiMoreModal from 'c/sfUiMoreModal';

// Fixture for the sf-ui combinations catalogue, batch 1: checkbox, toggle, radio group, checkbox group, dual listbox
// and date input, each echoing its value as text, placed in a record page tab, a sidebar, a LightningModal and a flow.
const options = (labels) => labels.map((l) => ({ label: l, value: l }));

export default class SfUiMore extends LightningElement {
    @api recordId;
    agree;
    notify;
    shade;
    extras = [];
    tools = [];
    visit;
    shades = options(['Red', 'Green', 'Blue']);
    extrasOptions = options(['Wifi', 'Lunch', 'Parking']);
    toolOptions = options(['Wrench', 'Drill', 'Pliers']);

    get extrasChosen() {
        return this.extras.join(', ');
    }

    get toolsChosen() {
        return this.tools.join(', ');
    }

    handleAgree(event) {
        this.agree = String(event.target.checked);
    }

    handleNotify(event) {
        this.notify = event.target.checked ? 'on' : 'off';
    }

    handleShade(event) {
        this.shade = event.detail.value;
    }

    handleExtras(event) {
        this.extras = event.detail.value;
    }

    handleTools(event) {
        this.tools = event.detail.value;
    }

    handleVisit(event) {
        this.visit = event.target.value;
    }

    handleOpen() {
        SfUiMoreModal.open({ size: 'medium', label: 'More dialog' });
    }
}
