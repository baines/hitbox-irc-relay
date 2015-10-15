var net     = require('net');
var http    = require('http');
var https   = require('https');
var assert  = require('assert');
var websock = require('ws');

function hbapi_get_json(url, callback_ok, callback_err){

	https.get(url, function(res){
		assert(res.statusCode == 200);
	
		res.on('data', function(data){
			var json;
			try {
				json = JSON.parse(data);
			} catch(e){
				callback_err(e);
				return;
			}
			callback_ok(json);
		});
	}).on('error', callback_err);
}

function get_chat_server(callback){

	var servers = [];
	
	hbapi_get_json('https://api.hitbox.tv/chat/servers', function(obj){
		obj.forEach(function(i){
			servers.push(i['server_ip']);
		});
		
		callback(servers[0]); //XXX: randomize?
		
	}, function(e){
		console.log('Error getting chat servers: ' + e.message);
	});
}

function get_chat_id(serv, callback){

	var url = 'http://' + serv + '/socket.io/1/'
	
	console.log('Getting ID from server [' + url + ']');

	http.get(url, function(res){
		assert(res.statusCode == 200);
		res.on('data', callback);
	}).on('error', function(e){
		console.log('Error getting chat id: ' + e.message);
	});
}

function get_auth_token(user, pass, callback){

	var post_data = JSON.stringify({
		login: user,
		pass: pass,
		app: 'desktop'
	});
	
	var opts = {
		hostname: 'api.hitbox.tv',
		port: 443,
		path: '/auth/token',
		method: 'POST',
		headers: {
			'Content-Length': post_data.length
		}
	}
	
	var req = https.request(opts, function(res){
		res.setEncoding('utf8');
		res.on('data', function(data){
			callback(data);
		});
	});
	
	req.write(post_data);
	req.end();
}

var clients = {};

function init_websocket(client){

	get_chat_server(function(serv){
		get_chat_id(serv, function(id){
			var url = 'ws://'
				    + serv
				    + '/socket.io/1/websocket/'
				    + id.toString().split(':')[0];

			ws_client = new websock(url);
	
			ws_client.on('open', function(){
				console.log('websocket opened');
			});
	
			ws_client.on('close', function(){
				console.log('websocket closed');
			});
	
			ws_client.on('message', function(data, flags){
				console.log('websocket got msg');
				relay_ws_to_irc(client, data.toString());
			});
			
			client.ws = ws_client;
		});
	});
}

function ws_msg(client, msg){
	console.log('sending ws msg: ' + msg);
	client.ws.send(msg);
}

function irc_msg(client, msg){
	console.log('sending irc msg: ' + msg);
	client.irc.write(':hitbox-irc ' + msg + '\r\n');
}

function irc_usr_msg(client, usr, msg){
	console.log('sending irc usr msg: ' + msg);
	client.irc.write(':' + usr + '!' + usr + '@hitbox-irc ' + msg + '\r\n');
}

var pending_msgs = {};

function relay_ws_to_irc(client, msg){
	console.log(msg);
	
	if(msg == '1::'){
		console.log('connecting client');
		irc_msg(client, '001 ' + client.user + ' :Greetings.');
		irc_msg(client, '002 ' + client.user + ' :Your host is a hitbox-irc-relay!');
		irc_msg(client, '003 ' + client.user + ' :Brought to you by insofaras.');
	}
	
	if(msg == '2::'){
		irc_msg(client, 'PING :hitbox-irc');
	}
	
	if(msg.substr(0, 4) == '5:::'){
		var user_obj = JSON.parse(msg.substr(4));
		
		console.log(user_obj);
		
		user_obj.args.forEach(function(str){
			var cmd = JSON.parse(str);
			
			console.log(cmd);
				
			if(cmd.method == 'loginMsg'){
				var get_names_obj = {
					name: 'message',
					args: [ {
						method: 'getChannelUserList',
						params: {
							channel: cmd.params.channel
						}
					} ]
				};
			
				ws_msg(client, '5:::' + JSON.stringify(get_names_obj));
				irc_usr_msg(client, client.user, 'JOIN :#' + cmd.params.channel);
			}
		
			if(cmd.method == 'userList'){
				var names = '353 ' + client.user + ' = #' + cmd.params.channel + ' :';

				cmd.params.data.admin.forEach(function(n){
					names += '@' + n + ' ';
				});
				cmd.params.data.user.forEach(function(n){
					names += '+' + n + ' ';
				});
				cmd.params.data.anon.forEach(function(n){
					names += n + ' ';
				});
				
				names.trim();
				
				irc_msg(client, names);
				irc_msg(client, '366 ' + client.user + ' #' + cmd.params.channel + ' :End of NAMES list');
			}
			
			if(cmd.method == 'chatMsg'){
				// don't echo our own msgs
				if(cmd.params.name == client.user && cmd.params.text in pending_msgs){
					delete pending_msgs[cmd.params.text];
					return;
				}
				
				irc_usr_msg(
					client,
					cmd.params.name,
					'PRIVMSG #' +
					cmd.params.channel +
					' :' +
					cmd.params.text
				);
			}
			
			if(cmd.method == 'motdMsg'){
				irc_usr_msg(
					client,
					cmd.params.name,
					'TOPIC #' +
					cmd.params.channel +
					' :' +
					cmd.params.text
				);
			}

		});
	}
}

function relay_irc_to_ws(irc_client, msg){

	var client = null;
	if(irc_client in clients){
		client = clients[irc_client];
	}
	
	var split_msg = msg.split(' ');
	
	console.log('got irc msg ' + split_msg[0]);

	if(!client){
		
		if(split_msg.length < 2 || split_msg[0] != 'PASS'){
		
			var tmp = {
				irc: irc_client
			};
		
			irc_msg(tmp, '464 you :Password incorrect');
			irc_msg(tmp, 'ERROR you :Bad password');
			irc_client.destroy();
		} else {	
			clients[irc_client] = {
				irc:   irc_client,
				ws:    null,
				user:  null,
				pass:  split_msg[1],
				token: null
			};
		}
		
	} else if(client.ws == null && client.user == null){
		
		if(split_msg.length < 2 || split_msg[0] != 'NICK'){
			//TODO: send error
			irc_client.destroy();
		} else {
			client.user = split_msg[1];
			
			get_auth_token(client.user, client.pass, function(data){
				var auth_obj = JSON.parse(data);
				
				if(auth_obj['error_msg'] == 'auth_failed' || !auth_obj.hasOwnProperty('authToken')){
					irc_msg(client, '464 ' + client.user + ' :Password incorrect');
					irc_msg(client, 'ERROR ' + client.user + ' :Bad password');
					irc_client.destroy();
				} else {
					client.token = auth_obj['authToken'];
					init_websocket(client);
				}
			});
		}
	
	} else {

		if(split_msg[0] == 'PING'){
			irc_msg(client, 'PONG ' + split_msg[1]);
		}

		if(split_msg[0] == 'PONG'){
			ws_msg(client, '2::');
		}
		
		if(split_msg[0] == 'JOIN'){
		
			var chan = split_msg[1];
			if(chan[0] == '#'){
				chan = chan.substr(1);
			}
			
			var login_obj = {
				name: 'message',
				args: [ {
					method: 'joinChannel',
					params: {
						channel: chan,
						name:    client.user,
						token:   client.token,
						isAdmin: false
					}
				} ]
			};
			ws_msg(client, '5:::' + JSON.stringify(login_obj));
		}
		
		if(split_msg[0] == 'PRIVMSG'){

			var chan = split_msg[1].substr(1);
			var txt = split_msg.slice(2).join(' ').substr(1);
			
			if(txt.length > 255){
				txt = txt.substr(0, 255);
			}
			
			var msg_obj = {
				name: 'message',
				args: [ {
					method: 'chatMsg',
					params: {
						channel: chan,
						name:    client.user,
						nameColor: '86BD25',
						text:    txt
					}
				} ]
			};
			
			ws_msg(client, '5:::' + JSON.stringify(msg_obj));
			pending_msgs[txt] = true;
		}
		
		if(split_msg[0] == 'TOPIC'){
		
			var chan = split_msg[1].substr(1);
			var motd = split_msg.slice(2).join(' ').substr(1);
		
			var motd_obj = {
				name: 'message',
				args: [ {
					method: 'motdMsg',
					params: {
						channel: chan,
						name: client.user,
						nameColor: '86BD25',
						text: motd
					}
				} ]
			};
			
			ws_msg(client, '5:::' + JSON.stringify(motd_obj));
		}
	}
}

var irc_server = net.createServer(function(client){

	client.on('end', function(){
		console.log('client dcd');
		if(client in clients){
			delete clients[client];
		}
	});
	
	client.on('data', function(data){		
		var lines = data.toString().split('\r\n');
		lines.forEach(function(l){
			if(l.length == 0) return;
			
			relay_irc_to_ws(client, l);
		});
	});
	
});

var irc_listen_port = 5555;

irc_server.listen(irc_listen_port, function(){
	console.log('IRC Relay listening on port ' + irc_listen_port);
});



