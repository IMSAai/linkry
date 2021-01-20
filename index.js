const Keycloak = require('keycloak-connect');
const hogan = require('hogan-express');
const express = require('express');
const session = require('express-session');
const csvdb = require("csv-database");
const fetch = require('node-fetch');
const baseURL = process.env.baseURL || 'out.epochml.org';
const favicon = require('serve-favicon');

var app = express();
var server = app.listen(9215, function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});

// Register '.mustache' extension with The Mustache Express
app.set('view engine', 'html');
app.set('views', require('path').join(__dirname, '/view'));
app.engine('html', hogan);

// Create a session-store to be used by both the express-session
// middleware and the keycloak middleware.

var memoryStore = new session.MemoryStore();

app.use(session({
  secret: 'mySecret',
  resave: false,
  saveUninitialized: true,
  store: memoryStore
}));

app.use(favicon(__dirname + '/public/img/favicon.ico'));

var keycloak = new Keycloak({
  store: memoryStore
});

async function getUserInfo(bearer_token) {
  const myHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${bearer_token}`
  };

  const response = await fetch('https://webauth.epochml.org/auth/realms/epochml.org/protocol/openid-connect/userinfo', {
    method: 'GET',
    headers: myHeaders,
  }).catch(error => { console.error(error); });
  if (response.status === 200) {
    return response.json();
  } else {
    throw new Error('Something went wrong on api server!');
  }
}

app.use(keycloak.middleware());
app.get('/', keycloak.protect(), async function (req, res) {
  let email;
  let name;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
    name = userInfo.name
  } catch (e) {
    res.status(500).render('500')
    return
  }
  res.render('index.html', { email, name, baseURL })
  return
})

app.post('/addURL', keycloak.protect(), async function (req, res) {
  let email;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
  } catch (e) {
    res.status(500).json({
      message: "Could not get user authorization information.",
      error: e
    })
    return
  }
  const db = await csvdb("links.csv", ["url", "name", "email"]).catch((e) => {
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  });
  const url = req.query.url;
  const name = req.query.name;
  if (url === undefined || name === undefined) {
    res.status(400).json({
      message: "Either url or name was not provided."
    })
    return
  }
  let old;
  try {
    old = await db.get({ name });
  } catch {
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  }

  if (old.length > 0) {
    res.status(400).json({
      message: "This short URL has already been taken. Please try another."
    });
  } else {
    await db.add({ url, name, email });
    res.json({
      url: req.query.url,
      shortURL: `https://out.epochml.org/${req.query.name}`,
      email
    });
    return
  }

});

app.get('/mylinks', keycloak.protect(), async function (req, res) {
  let email;
  let name;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
    name = userInfo.name
  } catch (e) {
    res.status(500).render('500')
  }
  const db = await csvdb("links.csv", ["url", "name", "email"]).catch((e) => {
    console.error(e)
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  });
  const all = await db.get({ email });
  res.render('mylinks', {
    data: all,
    name,
    email,
    baseURL
  })
})

app.delete('/deleteLink', keycloak.protect(), async function (req, res) {
  const name = req.query.name;
  const db = await csvdb("links.csv", ["url", "name", "email"]);
  try {
    await db.delete({ name })
  } catch (e) {
    res.status(500).json({
      message: "Could not delete the link. Please try again."
    })
    return
  }
  res.json({
    name,
    deleted: true
  })

})
app.put('/updateLink', keycloak.protect(), async function (req, res) {
  const name = req.query.name;
  const url = req.query.url;
  let dbCheck;
  const db = await csvdb("links.csv", ["url", "name", "email"]);
  try {
    await db.edit({ name }, { url })
    dbCheck = await db.get({ name });
  } catch (e) {
    res.status(500).json({
      message: "Could not update the link. Please try again."
    })
    return
  }
  res.json(dbCheck[0])

})
app.get('/:id', async function (req, res) {
  const name = req.params.id;
  const db = await csvdb("links.csv", ["url", "name", "email"]);
  const url = await db.get({ name });
  try {
    if (url.length < 1) {
      res.status(404).render('404.html')
    } else {
      res.redirect(url[0].url);
    }
  } catch {
    res.status(500).render('500')
  }

})