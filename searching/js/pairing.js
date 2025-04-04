const searchingForPeerServerCode = "CWRP-SearchForPeer"
const myUUID = `${generateRandomString(16, UUID_CHARACTERS)}-${Date.now()}` // from helping-functions
var isIdTakenCache = {}

function isPeerIdTaken_CreatePeerChecker(peerID){
    var checkPeerIDPeer = new Peer(peerID)
    isIdTakenCache[peerID] = null
    checkPeerIDPeer.on("open", (id) => {
        // not taken b/c we can use it
        checkPeerIDPeer.destroy()
        isIdTakenCache[peerID] = false
    })
    checkPeerIDPeer.on("error", (err) => {
        if (err.type == "unavailable-id") {
            checkPeerIDPeer.destroy()
            isIdTakenCache[peerID] = true
            return true
        }
    })
}

async function isPeerIdTaken(peerId){
    isPeerIdTaken_CreatePeerChecker(peerId)
    while (isIdTakenCache[peerId] == null) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return isIdTakenCache[peerId];
}

function reloadPage(){
    window.location.search = `?autosearch=${isSearching}`
    
    // do the reload if we are not searching b/c if we reload no matter what then the auto search url param gets lost
    if(isSearching == false){
        window.location.reload()
    }
}

// after 5 minutes of being host, we will refresh the page
// so if there is a malicious actor as the host this'll give us a chance to overthrow him
// TODO: Maybe we add a thing here side to prevent him from instantly connecting and make them wait like 3 seconds
setInterval(()=>{
    if(amIHost){
        reloadPage()
    }
}, 5 * 60 * 1000)

var peer
var connection
var allConnections = []
var amIHost = false
var availableServers = {}
var packetTypeData = {
    "SearchingStatusUpdate": { "Forward": true, "Verify": true },
    "AllAvailablePeople": { "Forward": false, "Verify": true }, // only host is sending so no one else should send, so why forward?
    "PairRequest": { "Forward": false, "Verify": true }, // it'll be forwarded to only one person, not everyone
    "FinalizedPairRequest": { "Forward": true, "Verify": true },
}
var currentlyPairingRequest = null // this'll be a UUID of someone we're trying to pair w/
var sendingPairRequestBackwards = 0 // if bigger than 0 we'll wait one request pair cycle before clearing and trying to pair.
// ^^ (gives time to fully establish a pair, and destroy it later if not successful)

var searchForOtherPersonCooldownBase = 1000
function requestToPairWithSomeone(uuidToTryAndPair){
    currentlyPairingRequest = uuidToTryAndPair
    pairPacketData = {
        "Type": "PairRequest",
        "UUID": myUUID,
        "RequestTo": uuidToTryAndPair
    }

    // if host, send only the person the packet, else send it to the host to forward it
    if (amIHost) {
        sendCertainPersonPacket(pairPacketData, uuidToTryAndPair)
    }
    else {
        sendAllConnections(pairPacketData)
    }
}
function finalizePairRequest(UUIDOfPair){
    console.log(`Send finalizePairRequest to ${UUIDOfPair}`)
    
    finalizedPairPacketData = {
        "Type": "FinalizedPairRequest",
        "UUID": myUUID,
        "PairedPerson": UUIDOfPair
    }

    sendAllConnections(finalizedPairPacketData)
    goToURLForFinalizedPair(UUIDOfPair)
}

function goToURLForFinalizedPair(UUIDOfPair){
    let pathname = "/pair_challenge/"
    let search = `?me=${myUUID}&other=${UUIDOfPair}`
    window.location.href = window.location.origin + pathname + search
}

function searchForOtherPerson(){
    if(sendingPairRequestBackwards > 0){
        sendingPairRequestBackwards -= 1
        return // we're sending pair packets, wait for the person to respond hopefully
    }

    currentlyPairingRequest = null
    // to make it easier to pair, we'll have a 50% chance to not send out pair signals
    // so 1/2 of the people will be sending pair packets while the other half will be waiting to get a pair packet
    if(randomNumberInclusiveInclusive(0, 1) == 1){ return }

    // only do all of this if we are actively searching.
    if (availableServers[myUUID] == false) { return }

    uuidsToCheck = Object.keys(availableServers)
    // I don't exist in the availableServers. This can only mean that I've never clicked the button, meaning I am not searching
    if (uuidsToCheck.includes(myUUID) == false) {
        if(isSearching){
            searchStateChange(isSearching)
        }
        return
    }

    searchingUUIDs = [] // UUIDs of people that are also searching

    for (let i = 0; i < uuidsToCheck.length; i++) {
        checkingUUID = uuidsToCheck[i]
        // We cannot pair w/ ourselves, so skip us
        if (checkingUUID == myUUID) { continue }
        // "true" means that the other person is also searching
        if (availableServers[checkingUUID] == true) {
            searchingUUIDs.push(checkingUUID)
        }
    }

    uuidToTryAndPair = searchingUUIDs[randomNumberInclusiveInclusive(0, searchingUUIDs.length - 1)]

    // no one to pair with. stopping function so we don't send a useless packet
    if(uuidToTryAndPair == null){ return }

    console.log(uuidToTryAndPair)
    // do sending the request packet

    requestToPairWithSomeone(uuidToTryAndPair)
}
function searchForOtherPersonHandler(){
    searchForOtherPerson()
    setTimeout(searchForOtherPersonHandler, searchForOtherPersonCooldownBase + randomNumberInclusiveInclusive(0, 2000))
    // vary the time so not everyone tries to search at the same instant, letting connections be easier in theory ^^^
}
searchForOtherPersonHandler()

function handlePacket(packetData, sendingConnection){
    console.log("Data received: ")
    console.log(packetData)

    var packetType = packetData["Type"]
    var packetSender = packetData["UUID"]

    if(amIHost){
        if (packetSender != sendingConnection.peer && packetTypeData[packetType]["Verify"]) {
            console.log("Sender is not who they claim to be. Dropping this packet")
            // the sender is not who they claim to be
            return
        }
        if (packetTypeData[packetType]["Forward"]) {
            sendAllConnections(packetData)
        }
    }


    switch (packetType) {
        case "SearchingStatusUpdate":
            var isSearching = packetData["IsSearching"]
            var whoIsBeingUpdated = packetSender
            availableServers[whoIsBeingUpdated] = isSearching
            break
        case "AllAvailablePeople":
            if(amIHost){
                // Why are we receiving this? We're the host, the only person that should send this.
                // I think something malicious is happening
                console.log("Why are we receiving an \"AllAvailablePeople\" packet? We're the host, the only person that should send this. I think something malicious is happening?")
                break
            }
            availableServers = packetData["AvailablePeople"]
            break
        case "PairRequest":
            var personBeingRequested = packetData["RequestTo"]
            if(amIHost && personBeingRequested != myUUID){
                // forward to the person they're trying to reach
                sendCertainPersonPacket(packetData, personBeingRequested)
                break // our job is done
            }
            if(personBeingRequested != myUUID){
                // we're not host and we're not the receiver this pair request. How did we get it???
                break
            }
            if(sendingPairRequestBackwards > 0 || currentlyPairingRequest != null){
                // two possibilities
                //   1) either someone is requesting us but we're already in a request
                //   2) or our pair request is being answered yes
                // actually, on the slight off chance that two users randomly choose the each other to pair with
                //   one of them will see it as an acceptance and will initiate a finalizePairRequest. Work out either way
                if(currentlyPairingRequest == packetSender){
                    // possibility 2, they're accepting!
                    finalizePairRequest(packetSender)
                    break
                }

                // we're already pairing and they're not accepting us (possibility 1), don't send anything back
                break
            }
            // we shall accept!!!!
            currentlyPairingRequest = packetSender
            sendingPairRequestBackwards = 1
            requestToPairWithSomeone(packetSender) // send a request back
            break
        case "FinalizedPairRequest":
            var pairedPerson = packetData["PairedPerson"]
            if(pairedPerson == myUUID && packetSender == currentlyPairingRequest){
                // looks like I am being summoned and the packet sender is who I am requesting
                goToURLForFinalizedPair(packetSender)
                break
            }
            break
        default:
            console.log("idk what type of packet this is ¯\\_(ツ)_/¯ | Packet:")
            console.log(packetData)
            break
    }
}

function sendCertainPersonPacket(data, personUUID){
    for (var i = 0; i < allConnections.length; i++) {
        var conn = allConnections[i]
        if (conn._open == false) { continue }
        if (conn.peer != personUUID) { continue }
        conn.send(data)
        break // we have sent the one person our packet. Now we save time & resources by exiting
    }
}

function sendAllConnections(data) {
    for (var i = 0; i < allConnections.length; i++) {
        var conn = allConnections[i]
        if(conn._open == false){ continue }
        conn.send(data)
    }
}

function sendAllAvailablePeoplePacket(){
    if (amIHost) {
        sendAllConnections({
            "Type": "AllAvailablePeople",
            "AvailablePeople": availableServers,
            "UUID": myUUID
        })
    }
}

async function main(){
    var isIdTaken = await isPeerIdTaken(searchingForPeerServerCode)
    var myId = isIdTaken ? myUUID : searchingForPeerServerCode
    // it's possible that if two people join when no one is the host then they'll both see that there is no server
    // so they'll both try and become it. Luckily only one can, so the other one will error out and refresh the page.
    // Also we'll use the UUID as their ID to solve some issues like verifying packets

    peer = new Peer(myId);
    connection = null
    peer.on("open", (id) => {
        amIHost = id == searchingForPeerServerCode

        console.log('My peer ID is: ' + id);
        if(amIHost == false){
            // We are a random ID, not the central server host...
            connection = peer.connect(searchingForPeerServerCode)
            establishConnection(connection)
        }
    })

    peer.on("error", (err)=>{
        console.log("An error occurred! " + err.message)
        console.error(err)
        reloadPage()
    })

    peer.on("connection", (conn) => {
        console.log("Connection:")
        console.log(conn)
        establishConnection(conn)
    })

    function establishConnection(connection) {
        allConnections.push(connection)
        connection.on("open", () => {
            connection.on("data", (data)=>{
                handlePacket(data, connection)
            })

            searchStateChange = (isSearching)=>{
                sendAllConnections({
                    "Type": "SearchingStatusUpdate",
                    "IsSearching": isSearching,
                    "UUID": myUUID,
                })
                // ^^^ Send to all b/c if we're the central server then we want to send to everyone. It can't hurt to do so anyways
                
                availableServers[myUUID] = isSearching
            }

            sendAllAvailablePeoplePacket()
            //connection.send("Hello world! " + peer.id)
        })

        connection.on("close", ()=>{
            console.log(`Connection closed : ${connection.peer}`)
            delete availableServers[connection.peer]
            sendAllAvailablePeoplePacket()

            //if(peer.id != searchingForPeerServerCode){
            // this new if statement seems like a better way to check if someone needs to claim the host
            if(amIHost == false){
                // Seems like the searching server was either closed or kicked us.
                // We are going to reload the page to reconnect and/or claim to be the host of the server
                reloadPage()
            }
        })
    }
}

// put everything into a main function so we can use async code w/o making this script's type "module"
main()