import { LightningElement, wire } from 'lwc';
import { gql, graphql } from 'lightning/uiGraphQLApi';

// Finds the seeded SFUIC Shape 1 record, so the forms need no Apex.
export default class SfUiCBaseForms extends LightningElement {
    recordId;
    recordStatus = '(loading)';
    formFields = ['Name', 'Status__c', 'Amount__c', 'Note__c'];

    @wire(graphql, {
        query: gql`
            query sfuicShape {
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
}
