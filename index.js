
const fs = require("fs");
const axios = require("axios");
const crypto = require("crypto");
const shell = require("shelljs");
const sizeOf = require("image-size");

const tencentcloud = require("tencentcloud-sdk-nodejs");
const TtsClient = tencentcloud.tts.v20190823.Client;  //text2audio
const NlpClient = tencentcloud.nlp.v20190408.Client;  //chatbot
const FtClient = tencentcloud.ft.v20200304.Client;  //face2cartoon

const {mixinConfig, tencentConfig} = require("./mixinConfig");
const {BlazeClient} = require("mixin-node-sdk");
const client = new BlazeClient(mixinConfig, {parse: true, syncAck: true});

async function aiChatbotTianxing(question) {
    const questionEncoded = encodeURI(question);
    const aiBotKey = "...";
    const aiBotApi = `http://api.tianapi.com/txapi/robot/index?key=${aiBotKey}&question=${questionEncoded}`;
    let answer = await axios.get(aiBotApi).catch(() => {return "我真不知道跟你说什么好了"});
    answer = answer.data;
    if (answer.code === 200) {
        const answerString = answer.newslist[0].reply;
        // console.log(answerString);
        return answerString;
    } else {
        console.log(`aiBot answer failed:\n${answer}`);
    }
}


async function aiChatbotTencent(question) {
    const clientConfig = {
        credential: {
          secretId: tencentConfig.secretId,
          secretKey: tencentConfig.secretKey,
        },
        region: "ap-guangzhou",
        profile: {
          httpProfile: {
            endpoint: "nlp.tencentcloudapi.com",
          },
        },
    };

    const chatbotClient = new NlpClient(clientConfig);
    const params = {
        "Flag": 1,
        "Query": question,
    };
    
    let r = await chatbotClient.ChatBot(params);
    return r.Reply;
}


async function aiChatbotJd(question) {
    const api = "https://aiapi.jd.com/jdai/chatbot";
    const appKey = "...";
    const secretKey = "...";
    const timeStamp = Date.now();
    const sign = crypto.createHash("md5").update(secretKey+timeStamp).digest("hex");

    const options = {params: {
        context: question,
        appkey: appKey,
        timestamp: timeStamp,
        sign: sign,
    }}

    let r = await axios.get(`${api}`, options).catch(() => {return "我真不知道跟你说什么好了"});
    r = r.data;
    if (r.code === "10000") {
        const answer = r.result.best_answer;
        return answer;
    } else {
        return `CODE: ${r.code}
10010请充值
10020系统繁忙
10030调用网关失败
10040超过每天限量
10043,10044超过QPS限额
10049超过每天最大调用量
10050用户已被禁用`
    }
}
// aiBotJd("胡萝卜叶子能吃吗").then(console.log)


async function aiAudiobotTencent(message) {
    const aiAudioConfig = {
        credential: {
            secretId: tencentConfig.secretId,
            secretKey: tencentConfig.secretKey,
        },
        region: "ap-beijing",
        profile: {
          httpProfile: {
            endpoint: "tts.tencentcloudapi.com",
          },
        },
    };
    
    const aiAudioClient = new TtsClient(aiAudioConfig);
    const params = {
        "Text": message,
        "SessionId": client.newUUID(),
        "Volume": 10,
        "Speed": 0,
        "ModelType": -1,
        "VoiceType": 101006
    };

    let r = await aiAudioClient.TextToVoice(params);
    let buff = new Buffer.from(r.Audio, "base64");
    let name = "./wav-files/" + Date.now() + ".wav";
    fs.writeFileSync(name, buff);

    return name;
}
// aiAudiobotTencent("你");


async function sendAudio(userId, audioFileName) {
    const audioNameNew = audioFileName + ".ogg";

    //opus-tools convert wav to opus+ogg type
    shell.exec(`opusenc --quiet --bitrate 111 ${audioFileName} ${audioNameNew}`);
    const audioFile = fs.readFileSync(audioNameNew);

    let audioSize;
    let audioDuration;

    //opus-tools get audio information:size, duration
    output = shell.exec(`opusinfo ${audioNameNew}`, {silent: true}).stdout;
    output.split("\n").forEach((e, i) => {
        if (e.includes("Total data length")) {
            //"Total data length: 19130 bytes (overhead: 5.43%)""
            audioSize = parseInt(e.split(": ")[1].split(" ")[0]);
        } 
        else if (e.includes("Playback length")) {
            //"Playback length: 0m:01.750s"
            audioDuration = parseFloat(e.split(": ")[1].split(":")[1]) * 1000;
        }
    })

    client.uploadFile(audioFile).then(r => {    
        para = {
            "attachment_id": r.attachment_id,
            "mime_type": "audio/ogg",
            "size": audioSize,
            "duration": audioDuration,
        }
    
        client.sendAudioMsg(userId, para);
    });
}


async function sendTextOrAudio(userId, message) {
    //get a 0~100 score
    const score = Math.floor(Math.random() * 100);

    if (score > 80) {
        aiAudiobotTencent(message).then(audioName => {
            sendAudio(userId, audioName);
        })
    } else {
        client.sendTextMsg(userId, message);
    }
}


async function sendAssetBack(transferBody) {
    const senderId = transferBody.data.opponent_id;
    const assetId = transferBody.data.asset_id;
    const assetAmount = transferBody.data.amount;
    const assetInfo = await client.readAsset(assetId);
    const assetName = assetInfo.symbol;
    const trans = await client.transfer(
        {
            asset_id: assetId,
            opponent_id: senderId,
            amount: assetAmount,
            trace_id: client.newUUID(),
            memo: `Refund退款${assetName}:${assetAmount}`,
        }
    );
    // console.log('TRANSACTION---> ', trans);
    if (trans.trace_id) {
        client.sendTextMsg(senderId, `Received asset ${assetAmount} ${assetName} and refunded.`);
    } else {
        client.sendTextMsg(senderId, `Refund failed.\n ${trans.description}`);
    }
}


async function face2Cartoon(imgUrl) {
    const clientConfig = {
        credential: {
            secretId: tencentConfig.secretId,
            secretKey: tencentConfig.secretKey,
        },
        region: "ap-beijing",
        profile: {
            httpProfile: {
                endpoint: "ft.tencentcloudapi.com",
            },
        },
    };

    console.log(imgUrl);

    const client = new FtClient(clientConfig);
    const params = {
        "Url": imgUrl,
        "RspImgType": "base64",
    };
    let r = await client.FaceCartoonPic(params);
    return r.ResultImage;
    // console.log(r.ResultImage);
}


client.loopBlaze({
    async onMessage(message) {
        if (message.type != "message"
            || !message.category
            || message.source != "CREATE_MESSAGE") {
            return;
        }

        console.log(message);
        const senderId = message.user_id;
    
        // 回复消息
        switch (message.category) {
            case "PLAIN_TEXT":
                // let answer = await aiChatbotTianxing(message.data);
                let answer = await aiChatbotTencent(message.data);
                // let answer = await aiChatbotJd(message.data);
                // client.sendTextMsg(senderId, answer);
                // let audioName = await aiAudiobotTencent(answer);
                // await sendAudio(senderId, audioName);

                sendTextOrAudio(senderId, answer);
                
                break;
                
            case "PLAIN_STICKER":
                client.sendStickerMsg(senderId, message.data);
                break;
            case "PLAIN_IMAGE":
                // client.sendImageMsg(senderId, message.data.attachment_id);
                client.showAttachment(message.data.attachment_id).then(r =>{
                    face2Cartoon(r.view_url).then(imgBase64String => {
                        imgFile = Buffer.from(imgBase64String, "base64");
                        const imgFileSize = Buffer.byteLength(imgFile);
                        const imgDimensions = sizeOf(imgFile);

                        client.uploadFile(imgFile).then(r => {
                            para = {
                                attachment_id: r.attachment_id,
                                mime_type: "image/jpeg",
                                width: imgDimensions.width,
                                height: imgDimensions.height,
                                size: imgFileSize,
                                // thumbnail?: string;
                            }
                            client.sendTextMsg(senderId, "我为你画了一张照片，你看看吧😊");
                            client.sendImageMsg(senderId, para);
                            
                        })
                    });
                });
                break;
            case "PLAIN_LOCATION":
                client.sendLocationMsg(senderId, message.data);
                break;
            case "PLAIN_LIVE":
                client.sendLiveMsg(senderId, message.data);
                break;
        }
    },

    async onTransfer(message) {
        if (parseFloat(message.data.amount) > 0) {
            await sendAssetBack(message);
        }
    },
});
   
