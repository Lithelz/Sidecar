# Local server for the dashboard: serves this folder, plus one helper endpoint.
#
# POST /ics (body = calendar feed URL) fetches an iCal feed on the page's behalf, because
# browsers are not allowed to read Google's calendar feeds directly. Only hosts listed in
# ALLOWED_HOSTS can be fetched, and the server only listens on this computer (127.0.0.1).
require 'webrick'
require 'net/http'
require 'uri'

PORT = 8080
ALLOWED_HOSTS = ['calendar.google.com'].freeze

server = WEBrick::HTTPServer.new(Port: PORT, BindAddress: '127.0.0.1', DocumentRoot: __dir__)

server.mount_proc '/ics' do |req, res|
  begin
    raise 'POST only' unless req.request_method == 'POST'
    uri = URI.parse(req.body.to_s.strip.sub(/\Awebcal:/, 'https:'))
    raise 'That calendar address is not allowed' unless uri.is_a?(URI::HTTPS) && ALLOWED_HOSTS.include?(uri.host)
    upstream = Net::HTTP.start(uri.host, 443, use_ssl: true, open_timeout: 10, read_timeout: 20) do |http|
      http.get(uri.request_uri)
    end
    res.status = upstream.code.to_i
    res['Content-Type'] = 'text/calendar; charset=utf-8'
    res.body = upstream.body.to_s
  rescue StandardError => e
    res.status = 400
    res['Content-Type'] = 'text/plain; charset=utf-8'
    res.body = e.message
  end
end

trap('INT') { server.shutdown }
server.start
