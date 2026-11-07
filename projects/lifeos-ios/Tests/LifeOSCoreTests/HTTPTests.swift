import Foundation
import XCTest
@testable import LifeOSCore

final class HTTPTests: XCTestCase {
    func testRejectsUnsuccessfulAndNonHTTPResponses() throws {
        let url = URL(string: "https://example.com/today.json")!
        for code in [301, 401, 404, 500] {
            let response = HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: nil)!
            XCTAssertThrowsError(try DemoHTTP.validate(Data("{}".utf8), response: response))
        }
        XCTAssertThrowsError(try DemoHTTP.validate(Data(), response: URLResponse(url: url, mimeType: nil,
                                                                                expectedContentLength: 0, textEncodingName: nil)))
    }

    func testAcceptsJSONAndRejectsUnboundedResponse() throws {
        let response = HTTPURLResponse(url: URL(string: "https://example.com")!, statusCode: 200,
                                       httpVersion: nil, headerFields: nil)!
        XCTAssertEqual(try DemoHTTP.validate(Data("{}".utf8), response: response), Data("{}".utf8))
        XCTAssertThrowsError(try DemoHTTP.validate(Data(repeating: 0, count: 1_048_577), response: response))
    }
}
