import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { gql, graphql } from 'lightning/uiGraphQLApi';
import LightningAlert from 'lightning/alert';
import LightningConfirm from 'lightning/confirm';
import LightningPrompt from 'lightning/prompt';
import Toast from 'lightning/toast';
import ToastContainer from 'lightning/toastContainer';

export default class SfUiCModules extends NavigationMixin(LightningElement) {
    alertResult = 'not opened';
    confirmResult = 'not opened';
    promptResult = 'not opened';
    toastCount = 0;
    recordId;
    recordStatus = '(loading)';

    connectedCallback() {
        const container = ToastContainer.instance();
        container.maxShown = 3;
        container.toastPosition = 'top-right';
    }

    @wire(graphql, {
        query: gql`
            query sfuicNavShape {
                uiapi {
                    query {
                        SfUiC_Shape__c(where: { Name: { eq: "SFUIC Shape 1" } }, first: 1) {
                            edges {
                                node {
                                    Id
                                }
                            }
                        }
                    }
                }
            }
        `
    })
    shape({ data, errors }) {
        if (data) {
            const edge = data.uiapi.query.SfUiC_Shape__c.edges[0];
            this.recordId = edge ? edge.node.Id : undefined;
            this.recordStatus = edge ? '' : '(not found: run seed-slice-1.apex)';
        } else if (errors) {
            this.recordStatus = '(query failed)';
        }
    }

    async openAlert() {
        await LightningAlert.open({ message: 'SFUIC alert message', theme: 'warning', label: 'SFUIC Alert' });
        this.alertResult = 'closed';
    }

    async openConfirm() {
        const ok = await LightningConfirm.open({ message: 'SFUIC confirm message', theme: 'info', label: 'SFUIC Confirm' });
        this.confirmResult = ok ? 'OK' : 'Cancel';
    }

    async openPrompt() {
        const value = await LightningPrompt.open({ message: 'SFUIC prompt message', label: 'SFUIC Prompt', defaultValue: 'SFUIC default' });
        this.promptResult = value === null ? 'Cancel' : `"${value}"`;
    }

    showToast() {
        this.toastCount += 1;
        Toast.show({ label: `SFUIC Toast ${this.toastCount}`, message: 'SFUIC lightning/toast message', variant: 'success', mode: 'dismissible' }, this);
    }

    showStickyToast() {
        this.toastCount += 1;
        Toast.show({ label: `SFUIC Sticky Toast ${this.toastCount}`, message: 'SFUIC sticky toast', variant: 'warning', mode: 'sticky' }, this);
    }

    go(event) {
        const target = event.target.dataset.target;
        const pages = {
            recordView: { type: 'standard__recordPage', attributes: { recordId: this.recordId, objectApiName: 'SfUiC_Shape__c', actionName: 'view' } },
            recordEdit: { type: 'standard__recordPage', attributes: { recordId: this.recordId, objectApiName: 'SfUiC_Shape__c', actionName: 'edit' } },
            newRecord: { type: 'standard__objectPage', attributes: { objectApiName: 'SfUiC_Shape__c', actionName: 'new' } },
            objectHome: { type: 'standard__objectPage', attributes: { objectApiName: 'SfUiC_Shape__c', actionName: 'home' } },
            listView: { type: 'standard__objectPage', attributes: { objectApiName: 'SfUiC_Shape__c', actionName: 'list' }, state: { filterName: 'SfUiC_Active' } },
            namedPage: { type: 'standard__namedPage', attributes: { pageName: 'home' } },
            webPage: { type: 'standard__webPage', attributes: { url: 'https://www.example.com' } }
        };
        this[NavigationMixin.Navigate](pages[target]);
    }
}
