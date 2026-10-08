#!/bin/zsh
# Double-click to start the dashboard. Close this window to stop it.
# Uses the Ruby that ships with macOS, so nothing needs installing.
cd "$(dirname "$0")"
(sleep 1 && open "http://127.0.0.1:8080/") &
/usr/bin/ruby server.rb
