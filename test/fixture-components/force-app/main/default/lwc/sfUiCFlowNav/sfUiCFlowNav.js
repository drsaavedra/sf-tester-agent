import { LightningElement, api } from 'lwc';
import { FlowNavigationBackEvent, FlowNavigationNextEvent, FlowNavigationFinishEvent } from 'lightning/flowSupport';

export default class SfUiCFlowNav extends LightningElement {
    @api label = 'SFUIC Flow Nav';
    @api availableActions = [];

    get canBack() {
        return this.availableActions.includes('BACK');
    }

    get canNext() {
        return this.availableActions.includes('NEXT') || this.availableActions.includes('FINISH');
    }

    back() {
        this.dispatchEvent(new FlowNavigationBackEvent());
    }

    next() {
        const event = this.availableActions.includes('NEXT') ? new FlowNavigationNextEvent() : new FlowNavigationFinishEvent();
        this.dispatchEvent(event);
    }
}
