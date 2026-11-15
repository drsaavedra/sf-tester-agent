@IsTest
private class S4Fix_StampTest {
    @IsTest static void stampsEachText() {
        System.assertEquals(new List<String>{'stamped:a', 'stamped:b'}, S4Fix_Stamp.stamp(new List<String>{'a', 'b'}));
    }
    @IsTest static void blankTextThrows() {
        try { S4Fix_Stamp.stamp(new List<String>{''}); System.assert(false, 'expected a throw'); }
        catch (IllegalArgumentException e) { System.assertEquals('Text is required', e.getMessage()); }
    }
}
