import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtitle=Category:Floor_plans&cmtype=file&cmlimit=50"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
response = urllib.request.urlopen(req, context=ctx)
data = json.loads(response.read().decode('utf-8'))

for member in data['query']['categorymembers']:
    title = member['title']
    if title.lower().endswith(".png") or title.lower().endswith(".jpg"):
        print(f"Found: {title}")
        
        img_url_req = f"https://commons.wikimedia.org/w/api.php?action=query&format=json&titles={urllib.parse.quote(title)}&prop=imageinfo&iiprop=url"
        req2 = urllib.request.Request(img_url_req, headers={'User-Agent': 'Mozilla/5.0'})
        response2 = urllib.request.urlopen(req2, context=ctx)
        img_data = json.loads(response2.read().decode('utf-8'))
        
        pages = img_data['query']['pages']
        img_url = list(pages.values())[0]['imageinfo'][0]['url']
        print(f"URL: {img_url}")
        
        # Download
        req3 = urllib.request.Request(img_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req3, context=ctx) as response3, open('real_floorplan.png', 'wb') as out_file:
            data3 = response3.read()
            out_file.write(data3)
        print("Downloaded real_floorplan.png")
        break
