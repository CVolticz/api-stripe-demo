// Enable .env
require('dotenv').config();

// import from nodeJS -> start an expressJS backend
const express = require("express");
const stripe = require("stripe")(process.env.STRIPE_API_SECRET)

// initialize express application
const app = express();

// Middleware required for Webhook Handler
app.use(
  express.json({
    verify: (req, res, buffer) => (req['rawBody'] = buffer),
  })
);

/**
 * On premise mock database use to store customer information
 * TODO: change this to production grade database
 */
const customers = {
  // stripeCustomerId : data
  stripeCutomerId: {
    apiKey: '123xyz',
    active: false,
    itemId: 'stripeItemId',
    call: 0,
  },
};

/**
 * Customer Api Key Map for quick customer ookup
 * Before to Hash Salt/Pepper this value accordingly
 */
const apiKeys = {
  // apiKey: customerdata
  "123xyz": "cust1"
};

/**
 * Functions to generate/hash the API Key
 * This APi Key will be given to the user
 * The ApiKey need to be Hash before storing it inside our database
 */
function generateAPIKey() {
  const { randomBytes } = require('crypto');
  const apiKey = randomBytes(16).toString('hex');
  const hashedAPIKey = hashAPIKey(apiKey);

  //ensure the API key is unique
  if(apiKeys[hashAPIKey]) {
    generateAPIKey();
  } else {
    return { hashedAPIKey, apiKey };
  }
};
function hashAPIKey(apiKey) {
  const { createHash } = require('crypto');
  const hashedAPIKey = createHash('sha256').update(apiKey).digest('hex');
  return hashedAPIKey;
}



/**
 * Implement Stripe Checkout Endpoint
 * Passing in user's payment information handled by stripe
 * Checking for Authorization
 */
 app.post("/checkout", async (req, res) => {
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
            {
                price: process.env.STRIPE_API_ID
            }
        ],
        success_url: 'http://localhost:5000/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'http://localhost:5000/error'

    })

    res.send(session);
});



// Listen to webhooks from Stripe when important events happen
app.post('/webhook', async (req, res) => {
  let data;
  let eventType;
  // Check if webhook signing is configured.
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (webhookSecret) {
    // Retrieve the event by verifying the signature using the raw body and secret.
    let event;
    let signature = req.headers['stripe-signature'];

    try {
      event = stripe.webhooks.constructEvent(
        req['rawBody'],
        signature,
        webhookSecret
      );
    } catch (err) {
      console.log(`⚠️  Webhook signature verification failed.`);
      return res.sendStatus(400);
    }
    // Extract the object from the event.
    data = event.data;
    eventType = event.type;
  } else {
    // Webhook signing is recommended, but if the secret is not configured in `config.js`,
    // retrieve the event data directly from the request body.
    data = req.body.data;
    eventType = req.body.type;
  }

  switch (eventType) {
    case 'checkout.session.completed':
      // Data included in the event object:
      const customerId = data.object.customer;
      const subscriptionId = data.object.subscription;

      console.log(
        `💰 Customer ${customerId} subscribed to plan ${subscriptionId}`
      );

      // Get the subscription. The first item is the plan the user subscribed to.
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = subscription.items.data[0].id;

      // Generate API key
      const { apiKey, hashedAPIKey } = generateAPIKey();
      console.log(`User's API Key: ${apiKey}`);
      console.log(`Hashed API Key: ${hashedAPIKey}`);

      // Store the API key in your database.
      customers[customerId] = {
        apikey: hashedAPIKey,
        itemId,
        active: true,
      };
      apiKeys[hashedAPIKey] = customerId;

      break;
    case 'invoice.paid':
      // Continue to provision the subscription as payments continue to be made.
      // Store the status in your database and check when a user accesses your service.
      // This approach helps you avoid hitting rate limits.
      break;
    case 'invoice.payment_failed':
      // The payment failed or the customer does not have a valid payment method.
      // The subscription becomes past_due. Notify your customer and send them to the
      // customer portal to update their payment information.
      break;
    default:
    // Unhandled event type
  }

  res.sendStatus(200);
});
  


// Get information about the customer
app.get('/customers/:id', (req, res) => {
  const customerId = req.params.id;
  const account = customers[customerId];
  if (account) {
    res.send(account);
  } else {
    res.sendStatus(404);
  }
});


// Simple GET Request API implementing Stripe system
app.get("/api", async (req, res) => {
    // Only subscribed custoemrs can use the api
    const { apiKey } = req.query;
    if (!apiKey) {
      res.sendStatus(400);
    }

    // hash input API key to look for the customer
    // check for customer active state
    const hashedAPIKey = hashAPIKey(apiKey);
    const customerId = apiKeys[hashedAPIKey];
    const customer = customers[customerId];

    if (!customer || !customer.active) {
      res.sendStatus(403); // not authorized
    } else {
  
      // Record usage with Stripe Billing
      const record = await stripe.subscriptionItems.createUsageRecord(
        customer.itemId,
        {
          quantity: 1,
          timestamp: 'now',
          action: 'increment',
        }
      );
      res.send({ data: '🔥🔥🔥🔥🔥🔥🔥🔥', usage: record });
    }

});



const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Server Start on Port: ${port}`));