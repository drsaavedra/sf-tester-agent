import { LightningElement } from 'lwc';

// Fixture for the sf-ui combinations catalogue: a screen flow run by lightning-flow inside a custom component,
// which swaps the flow for its own line once the flow reports it finished.
export default class SfUiFlowHost extends LightningElement {
    finished = false;

    handleStatus(event) {
        if (event.detail.status === 'FINISHED' || event.detail.status === 'FINISHED_SCREEN') this.finished = true;
    }
}
