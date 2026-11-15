// Coverage for the probe component's Ping call, so the fixture deploys to a Developer Edition validation org.
@IsTest
private class SfUiProbeControllerTest {
    @IsTest
    static void pingAnswersWithTheRecordId() {
        Id recordId = '001000000000000AAA';
        System.assertEquals('pong ' + recordId, SfUiProbeController.ping(recordId));
    }

    // Covers the S4Map_ fixture class and its trigger here, as the deploy's one named test class.
    @IsTest
    static void s4MapSaveRunsTheTrigger() {
        Id id = S4Map_Controller.saveItem('x', 1);
        System.assertEquals('trigger', [SELECT Note__c FROM S4Map_Item__c WHERE Id = :id].Note__c);
    }
}
