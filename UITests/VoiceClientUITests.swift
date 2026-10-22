import XCTest

/// Verifies the built app can actually launch and render its first screen.
final class VoiceClientUITests: XCTestCase {
    func testAppLaunchesWithSafeInitialState() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Voice Assistant"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.secureTextFields["Paste OpenRouter API key"].exists)
        XCTAssertTrue(app.buttons["Save key"].exists)
        XCTAssertTrue(app.textFields["Or type a message"].exists)
        XCTAssertTrue(app.buttons["Send"].exists)
        XCTAssertFalse(app.buttons["Send"].isEnabled)
    }
}
