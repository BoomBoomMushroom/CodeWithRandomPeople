var searchingButton = document.getElementById("StartSearchingButtonText")
var searchingForPeopleLoader = document.getElementById("searchingForPeopleLoader")

var isSearching = false
var searchStateChange = ()=>{}
function searchButtonClicked(){
    isSearching = !isSearching
    searchingButton.innerText = isSearching ? "Stop Searching" : "Start Coding"
    
    if(isSearching){
        searchingForPeopleLoader.classList.remove("hidden")
    }
    else{
        searchingForPeopleLoader.classList.add("hidden")
    }
    
    try{
        searchStateChange(isSearching)
    }
    catch{}
}

// put on our auto search (if true) on page load
document.body.onload = ()=>{
    let urlParams = new URLSearchParams(window.location.search);
    let doAutoSearch = urlParams.get("autosearch") == "true";;
    
    if(doAutoSearch){
        // invert it then "click the button"
        isSearching = !doAutoSearch
        searchButtonClicked()
    }
}