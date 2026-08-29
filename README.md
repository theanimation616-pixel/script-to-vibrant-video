# Script to Manga Maker

Due to users browser limitations complete process must be on server side (as possible as)

https://www.pixazo.ai/models/

Pixazo api key 

03178ba869a446eba82bce98a79fefc3

note:- pixazo api key is with 0 credits balance so make sure use only free ai model FLUX.1 Schnell.

Z.ai api key

ace9fc2a05b9455da99a64c451855129.HHxUH3zhGCZiq9Hl

note:- z.ai api key is with 0 credits balance so make sure use only free ai models GLM-4.6V-Flash or GLM 4.5 flash

From above given platform use pixazo FLUX.1 Schnell. model for image generation And  GLM-4.6V-Flash

 this model for prompt writing and build web app for genrate complete manga images for script.

Build an script to manga ai 

User will upload complete script with timestamps - web app using GLM-4.6V-Flash

 generate one prompt per timestamps - pixazo

  FLUX.1 Schnell.   model this Model will generate images for all prompts in sequence according script - adjust all images in sequence according script timestamps. Ex assume it's an script 0:00)Henan की कहानी असुरा का उदय. Henan नाम का एक साधारण लड़का था. (0:05)

वह Mumbai के एक पुराने building की छोटी सी किराए की कोठरी में रहता था. (0:09)  Then write prompt and generate images for this script adjust 1st image for 0:00 to 0:05 2nd image 0:05 to 0:09 and so on and create complete video using ffmpeg. And allow user to download.

1. Make sure generate complete manga images for complete script 

2. One image per timestamps 

3. Used fixed manga style for all images 

4. Auto retry for failed generation 

5. Make sure use all consistent characters according script 

6. Script will exactly look like this 

(0:00)Henan की कहानी असुरा का उदय. Henan नाम का एक साधारण लड़का था. (0:05)

वह Mumbai के एक पुराने building की छोटी सी किराए की कोठरी में रहता था. (0:09)

कमरा इतना छोटा था कि एक बिस्तर, एक छोटी अलमारी और एक खिड़की के अलावा कुछ जगह ही नहीं बचती थी. (0:16)

उसी कमरे में उसकी बहन मीरा भी रहती थी. मीरा पांच साल पहले हुए एक सड़क हादसे के बाद से paralyzed हो गई थी. (0:24)

उस दिन बारिश हो रही थी. Henan school से लौट रहा था और मीरा उसे लेने आई थी. (0:29)

अचानक एक track फिसल गया. Henan बच गया, लेकिन मीरा की कमर की हड्डी टूट गई. (0:35)

Doctorओं ने कहा कि अब वह कभी नहीं चल पाएगी. उस दिन के बाद से Henn की ज़िंदगी पूरी तरह बदल गई. (0:42)

मां बाप नहीं थे. चाचा चाची ने कुछ दिनों मदद की. फिर कहने लगे कि हम और नहीं संभाल सकते. (0:49)

Henn ने पढ़ाई छोड़ दी. छोटी मोटी नौकरियां करने लगा. पहले एक दुकान पर सामान उठाता था.

7. Make sure this web app handle 100000 character script properly (30000+ words)

8. Make sure all images must be in 16:9 aspect ratio. Make sure never generate images in 9:16 or any other aspects ratio it must be fixed 16:9 aspect ratio.

9. Also make sure web app must show real time progress 

10. Make sure generate proper final video by adjusting images according timestamps and allow user to download.



Everything perfect but issue is:-

Web app create 1st consistent characters according story then writing prompt according story but problem is web app generating perfect image according prompt but adding extra image of character which is created for consistency. For ex.(0:00) Henan की कहानी असुरा का उदय. Henan नाम का एक साधारण लड़का था. (0:05)

वह Mumbai के एक पुराने building की छोटी सी किराए की कोठरी में रहता था. This is script. Web app creating consistent character "heman" then it's writing prompt for (0:00) Henan की कहानी असुरा का उदय. Henan नाम का एक साधारण लड़का था. then it's generating image for prompt. But in image showing perfect sence according prompt + extra consistent character image. Means adding extra image of character + original sence of prompt.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4136d8de-a4fd-4562-8e20-09a3ccacd833).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
