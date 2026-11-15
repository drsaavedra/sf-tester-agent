import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Fixture for the sf-ui combinations catalogue, batch 3: user experience states (a validation error, a loading
// spinner, a toast) and slider, rich text, pills, tree and an inner tabset, each echoing its result as text.
export default class SfUiStates extends LightningElement {
    codeOk = false;
    loading = false;
    loaded = false;
    volume = 50;
    volumeSet = false;
    story;
    removed;
    leaf;
    innerTwo = false;
    pills = ['Alpha', 'Beta', 'Gamma'].map((l) => ({ label: l, name: l }));
    tree = [{ label: 'Europe', name: 'europe', expanded: false, items: [{ label: 'Lisbon', name: 'lisbon', items: [] }, { label: 'Oslo', name: 'oslo', items: [] }] }];

    handleCheck() {
        const input = this.template.querySelector('lightning-input');
        this.codeOk = input.reportValidity() && !!input.value;
    }

    handleLoad() {
        this.loading = true;
        this.loaded = false;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => { this.loading = false; this.loaded = true; }, 1500);
    }

    handleToast() {
        this.dispatchEvent(new ShowToastEvent({ title: 'States toast', message: 'Raised from the states component', variant: 'success' }));
    }

    handleVolume(event) {
        this.volume = event.detail.value;
        this.volumeSet = true;
    }

    handleStory(event) {
        this.story = (event.target.value || '').replace(/<[^>]+>/g, '').trim();
    }

    handleRemove(event) {
        this.removed = event.detail.item.label;
        this.pills = this.pills.filter((p) => p.name !== event.detail.item.name);
    }

    handleTree(event) {
        this.leaf = event.detail.name;
    }

    handleInner() {
        this.innerTwo = true;
    }
}
