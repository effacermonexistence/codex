import Foundation

/// Frozen metadata fixtures, not plugin activation or native execution evidence.
/// Exact 26.1016 bytes match the signed app bundle; replacing only its version
/// also reproduces every already-pinned 26.1013 manifest SHA-256.
enum NativeCleanupManifestFixtures {
    static let reviewed: [String: Data] = [
        "browser": Data(#"""
        {
          "version": "26.1016.61520",
          "name": "browser",
          "hooks": {
            "hooks": {
              "Interrupt": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "SubagentStop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${agent_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "Stop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ]
            }
          },
          "description": "Browser / browser-use plugin\n\nAliases: @browser, @browser-use, browser-use, Browser, in-app browser.\n\nUse Browser, the ChatGPT in-app browser, when the user asks to open, inspect, navigate, test, click, type, or screenshot local web targets such as localhost, 127.0.0.1, ::1, file:// URLs, or the current in-app browser tab.\n\nAfter significant frontend changes to a local app, use Browser to open the relevant local target when it is known or obvious, unless the user asks for another browser tool.\n\nFor requests like \"open localhost:3000\" or \"open to localhost:4000\", navigate the in-app browser to http://localhost:3000 or http://localhost:4000.\n\nDo not satisfy explicit @browser or @browser-use requests with macOS `open`, shell commands, or generic web browsing unless the user asks for another browser tool or approves a fallback.",
          "author": {
            "name": "OpenAI"
          },
          "homepage": "https://github.com/openai/openai/tree/master/lib/oai_browser_use/plugin",
          "repository": "https://github.com/openai/openai/tree/master/lib/oai_browser_use/plugin",
          "license": "Proprietary",
          "keywords": [
            "browser",
            "automation",
            "chrome",
            "iab",
            "node-repl",
            "browser-client"
          ],
          "skills": "./skills/",
          "interface": {
            "displayName": "Browser",
            "shortDescription": "Control the in-app browser",
            "longDescription": "Browser lets ChatGPT open and control the in-app browser, mainly for local development pages and files. Use it to navigate, inspect, click, type, and take screenshots while testing pages inside ChatGPT.",
            "developerName": "OpenAI",
            "category": "Engineering",
            "capabilities": [
              "Interactive",
              "Read",
              "Write"
            ],
            "websiteURL": "https://openai.com/",
            "privacyPolicyURL": "https://openai.com/policies/row-privacy-policy/",
            "termsOfServiceURL": "https://openai.com/policies/row-terms-of-use/",
            "defaultPrompt": [
              "Test my checkout flow on localhost"
            ],
            "brandColor": "#013B7B",
            "composerIcon": "./assets/composer-icon.png",
            "logo": "./assets/browser.png",
            "screenshots": []
          }
        }
        """#.utf8) + Data([10]),
        "chrome": Data(#"""
        {
          "name": "chrome",
          "hooks": {
            "hooks": {
              "Interrupt": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "SubagentStop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${agent_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "Stop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "node_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ]
            }
          },
          "version": "26.1016.61520",
          "description": "Chrome automation for tasks that depend on the user's existing Chrome state: tabs, logged-in sessions, cookies, extensions, and ChatGPT Chrome Extension setup. Prefer purpose-built connectors, APIs, or CLIs. If one fails due to missing or expired authentication, ask the user to reauthenticate or explicitly approve Chrome as a fallback.",
          "author": {
            "name": "OpenAI"
          },
          "homepage": "https://github.com/openai/openai/tree/master/lib/oai_browser_use/plugin",
          "repository": "https://github.com/openai/openai/tree/master/lib/oai_browser_use/plugin",
          "license": "Proprietary",
          "keywords": [
            "browser",
            "chrome"
          ],
          "skills": "./skills/",
          "interface": {
            "displayName": "Chrome",
            "shortDescription": "Control Chrome with ChatGPT",
            "longDescription": "Chrome lets ChatGPT use your Chrome browser for tasks that need your existing browser state, including open tabs, page content, and websites you're already signed into. It can navigate, view, click, type, and take screenshots while working. You stay in control: ChatGPT asks before interacting with new sites, you can stop actions at any time, and you can manage or remove Chrome access in settings. Browser content may include sensitive information from logged-in sites. Browser data from using this plugin may be used for training, subject to your OpenAI account data controls.",
            "developerName": "OpenAI",
            "category": "Productivity",
            "capabilities": [
              "Interactive",
              "Read"
            ],
            "websiteURL": "https://openai.com/",
            "privacyPolicyURL": "https://openai.com/policies/row-privacy-policy/",
            "termsOfServiceURL": "https://openai.com/policies/row-terms-of-use/",
            "defaultPrompt": [
              "file my expenses for me",
              "review my messages on social media",
              "put in a PTO request in Workday"
            ],
            "brandColor": "#10A37F",
            "composerIcon": "./assets/google-chrome-composer.png",
            "logo": "./assets/google-chrome.png",
            "screenshots": []
          }
        }
        """#.utf8) + Data([10]),
        "unified-computer-use": Data(#"""
        {
          "version": "26.1016.61520",
          "name": "unified-computer-use",
          "hooks": {
            "hooks": {
              "Interrupt": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "cua_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "SubagentStop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "cua_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${agent_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ],
              "Stop": [
                {
                  "hooks": [
                    {
                      "type": "mcp_tool",
                      "server": "cua_repl",
                      "tool": "turn_ended",
                      "input": {
                        "hook_event_name": "${hook_event_name}",
                        "session_id": "${session_id}",
                        "turn_id": "${turn_id}"
                      }
                    }
                  ]
                }
              ]
            }
          },
          "description": "App-managed browser automation runtime.",
          "mcpServers": "./.mcp.json"
        }
        """#.utf8) + Data([10]),
    ]
}
