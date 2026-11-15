// Fixture for the sf-ui tests: the server call the probe component's Ping button makes.
// SfUiProbeControllerTest covers it for a Developer Edition validation org.
public with sharing class SfUiProbeController {
    @AuraEnabled
    public static String ping(Id recordId) {
        return 'pong ' + recordId;
    }
}
